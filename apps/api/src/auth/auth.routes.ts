import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import type { Database } from "../database/database.js";
import { recordAuditSafely } from "./audit.js";
import { expiredSessionCookie, readCookie, serializeSessionCookie } from "./cookies.js";
import { hashPassword, verifyPassword } from "./password.js";
import { FixedWindowRateLimit } from "./rate-limit.js";
import {
  clientFingerprint,
  createSession,
  resolveSession,
  revokeSession,
  SESSION_COOKIE,
  SESSION_TTL_HOURS,
  type AuthenticatedSession,
  type SessionRole,
} from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    session: AuthenticatedSession | null;
  }
}

type AuthRouteOptions = {
  database: Database;
};

const ROLE_RANK: Record<SessionRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

// A hash of a password nobody has, used to spend the same CPU time on a
// missing account as on a real one. Without it, "no such user" returns in
// microseconds and "wrong password" takes ~100ms, which is a working account
// enumeration oracle no matter how carefully the error text is worded.
let decoyHash: string | null = null;

async function getDecoyHash(): Promise<string> {
  decoyHash ??= await hashPassword(
    "there is no account here and this string is never a password",
  );

  return decoyHash;
}

function fingerprintFor(request: FastifyRequest): string | null {
  return clientFingerprint(
    request.ip,
    process.env.SESSION_SECRET ?? "zerofayyz-sandbox-fingerprint-key",
  );
}

/**
 * Requires a signed-in user of at least the given role.
 *
 * Enforced here, on the server, for every request. The dashboard hides controls
 * a viewer may not use, but hiding a button is presentation, not security —
 * the only thing standing between a viewer and a refund endpoint is this.
 */
export function requireRole(minimum: SessionRole) {
  return async function guard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.session) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    if (ROLE_RANK[request.session.role] < ROLE_RANK[minimum]) {
      return reply.code(403).send({
        error: `This action requires the ${minimum} role`,
      });
    }

    return undefined;
  };
}

/**
 * Resolves the session for every request, once, before any route runs.
 *
 * This is installed on the root instance in app.ts rather than inside the auth
 * plugin. Fastify encapsulates hooks in the scope that registers them, so a
 * hook added inside this plugin would decorate only the auth routes — and
 * `request.session` would be undefined everywhere else, making every
 * requireRole guard outside this file refuse everyone.
 */
export function sessionResolver(database: Database) {
  return async function resolve(request: FastifyRequest) {
    request.session = await resolveSession(
      database,
      readCookie(request.headers.cookie, SESSION_COOKIE),
    );
  };
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  { database },
) => {
  // Five attempts per fingerprint per fifteen minutes. Enough that a person
  // who mistypes twice and then checks their password manager is unaffected;
  // far too few for anyone working through a word list.
  //
  // Scoped to this app instance, not the module. A module-level limiter is
  // created at import time, shared by every buildApp() in the process, and
  // survives app.close() — invisible in production, where one process runs one
  // app, but in a test suite it means five failed logins in one file rate-limit
  // every file after it.
  const loginLimiter = new FixedWindowRateLimit(5, 15 * 60 * 1000);

  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "password"],
          properties: {
            email: { type: "string", maxLength: 254 },
            password: { type: "string", maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const fingerprint = fingerprintFor(request);
      const limitKey = fingerprint ?? "unknown";
      const limit = loginLimiter.check(limitKey);

      if (!limit.allowed) {
        await recordAuditSafely(
          database,
          {
            action: "auth.login.rate_limited",
            entityType: "session",
            clientFingerprint: fingerprint,
            metadata: { retryAfterSeconds: limit.retryAfterSeconds },
          },
          (error) => request.log.error({ error }, "audit write failed"),
        );

        return reply
          .code(429)
          .header("retry-after", String(limit.retryAfterSeconds))
          .send({ error: "Too many attempts. Try again shortly." });
      }

      const email = request.body.email.trim().toLowerCase();
      const result = await database.query<
        { id: string; password_hash: string | null; role: SessionRole },
        [string]
      >(
        `
          SELECT id, password_hash, role
            FROM users
           WHERE LOWER(email) = $1
             AND role <> 'customer'
        `,
        [email],
      );

      const user = result.rows[0];
      // Verify against the decoy when there is no user, so both paths cost the
      // same. Assigning the result to a variable that is then ignored is
      // deliberate — an early return here is the whole vulnerability.
      const stored = user?.password_hash ?? (await getDecoyHash());
      const passwordMatches = await verifyPassword(request.body.password, stored);

      if (!user || !passwordMatches) {
        await recordAuditSafely(
          database,
          {
            action: "auth.login.failed",
            entityType: "session",
            clientFingerprint: fingerprint,
            // The attempted address is recorded; the attempted password never
            // is, not even hashed, not even on failure.
            metadata: { email },
          },
          (error) => request.log.error({ error }, "audit write failed"),
        );

        return reply.code(401).send({ error: "Incorrect email or password" });
      }

      const { token, expiresAt } = await createSession(database, user.id, fingerprint);

      await database.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
        user.id,
      ]);

      loginLimiter.reset(limitKey);

      const session = await resolveSession(database, token);

      await recordAuditSafely(
        database,
        {
          action: "auth.login.succeeded",
          entityType: "session",
          entityId: session?.sessionId ?? null,
          actorUserId: user.id,
          sessionId: session?.sessionId ?? null,
          clientFingerprint: fingerprint,
        },
        (error) => request.log.error({ error }, "audit write failed"),
      );

      return reply
        .code(200)
        .header(
          "set-cookie",
          serializeSessionCookie(SESSION_COOKIE, token, {
            maxAgeSeconds: SESSION_TTL_HOURS * 60 * 60,
            expires: expiresAt,
          }),
        )
        .send({
          user: {
            email: session?.email ?? email,
            displayName: session?.displayName ?? "",
            role: user.role,
          },
          expiresAt: expiresAt.toISOString(),
        });
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const session = request.session;

    if (token) {
      await revokeSession(database, token);
    }

    if (session) {
      await recordAuditSafely(
        database,
        {
          action: "auth.logout",
          entityType: "session",
          entityId: session.sessionId,
          actorUserId: session.userId,
          sessionId: session.sessionId,
          clientFingerprint: fingerprintFor(request),
        },
        (error) => request.log.error({ error }, "audit write failed"),
      );
    }

    // The cookie is cleared whether or not a session was found, so a stale or
    // forged cookie does not survive a logout the user believes worked.
    return reply
      .code(200)
      .header("set-cookie", expiredSessionCookie(SESSION_COOKIE))
      .send({ signedOut: true });
  });

  app.get("/auth/me", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "Not signed in" });
    }

    return reply.send({
      email: request.session.email,
      displayName: request.session.displayName,
      role: request.session.role,
    });
  });
};
