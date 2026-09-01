/**
 * Passwordless sign-in: magic links.
 *
 * Request: POST /auth/magic-link { email } — always answers 202, whether or
 * not the account exists, for the same reason login verifies against a decoy
 * hash: the response must not be an oracle for which emails are registered.
 * When the account is real, a token row is written and the email leg is
 * enqueued as a job (auth.magic_link_email) — mail providers are exactly the
 * flaky dependency retry-with-backoff exists for, and a dead email job shows
 * on /admin/jobs instead of failing silently inside a request.
 *
 * Consume: POST /auth/magic/consume { token } — the single-use guarantee is
 * one atomic UPDATE (`used_at IS NULL` in the WHERE), so two clicks racing on
 * the same link produce exactly one session. On success it sets the same
 * session cookie the password door sets; from that point the two doors are
 * indistinguishable, including revocation.
 */
import { createHash, randomBytes } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";

import type { Database } from "../database/database.js";
import type { JobQueue } from "../jobs/queue.js";
import { recordAuditSafely } from "./audit.js";
import { serializeSessionCookie } from "./cookies.js";
import { FixedWindowRateLimit } from "./rate-limit.js";
import {
  clientFingerprint,
  createSession,
  resolveSession,
  SESSION_COOKIE,
  SESSION_TTL_HOURS,
} from "./sessions.js";

function fingerprintFor(ip: string | undefined): string | null {
  return clientFingerprint(
    ip,
    process.env.SESSION_SECRET ?? "zerofayyz-sandbox-fingerprint-key",
  );
}

export const MAGIC_LINK_TTL_MINUTES = 15;
export const MAGIC_LINK_EMAIL_JOB = "auth.magic_link_email";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a token row and returns the raw token. The row stores only the hash. */
export async function issueLoginToken(
  database: Database,
  userId: string,
  fingerprint: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60_000);

  await database.query(
    `INSERT INTO login_tokens (user_id, token_hash, expires_at, client_fingerprint)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(token), expiresAt.toISOString(), fingerprint],
  );

  return { token, expiresAt };
}

/**
 * Marks the token used and returns its owner — or null for a token that is
 * unknown, expired, already used, or belongs to a disabled account. One
 * statement; the WHERE is the whole security argument.
 */
export async function consumeLoginToken(
  database: Database,
  token: string,
): Promise<{ userId: string } | null> {
  const result = await database.query<{ user_id: string }>(
    `UPDATE login_tokens t SET used_at = NOW()
      WHERE t.token_hash = $1
        AND t.used_at IS NULL
        AND t.expires_at > NOW()
        AND EXISTS (
          SELECT 1 FROM users u
           WHERE u.id = t.user_id
             AND u.role <> 'customer'
             AND u.disabled_at IS NULL
        )
      RETURNING t.user_id`,
    [hashToken(token)],
  );

  const row = result.rows[0];
  return row ? { userId: row.user_id } : null;
}

type MagicRouteOptions = {
  database: Database;
  queue: JobQueue;
};

export const magicLinkRoutes: FastifyPluginAsync<MagicRouteOptions> = async (
  app,
  { database, queue },
) => {
  // Requests are limited per mailbox, counting every request — unlike the
  // password limiter, which counts only failures. There is no "successful
  // attempt" to exempt here: each request emails someone, so the thing being
  // limited is outbound mail, not guessing.
  // Three links per mailbox per fifteen minutes.
  const requestLimiter = new FixedWindowRateLimit(3, 15 * 60_000);

  app.post<{ Body: { email: string } }>(
    "/auth/magic-link",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email"],
          properties: { email: { type: "string", format: "email", maxLength: 254 } },
        },
      },
    },
    async (request, reply) => {
      const email = request.body.email.trim().toLowerCase();
      const fingerprint = fingerprintFor(request.ip);

      const limit = requestLimiter.status(email);
      if (limit.blocked) {
        return reply
          .code(429)
          .header("retry-after", String(limit.retryAfterSeconds))
          .send({ error: "Too many link requests. Try again shortly." });
      }
      requestLimiter.recordFailure(email); // every request spends budget — see above

      const result = await database.query<{ id: string; email: string }>(
        `SELECT id, email FROM users
          WHERE LOWER(email) = $1 AND role <> 'customer' AND disabled_at IS NULL`,
        [email],
      );

      const user = result.rows[0];
      if (user) {
        const { token } = await issueLoginToken(database, user.id, fingerprint);

        // The link points at the DASHBOARD origin, not the API: the session
        // cookie is first-party to the dashboard, so consumption must travel
        // through its proxy — the same shape as the password login.
        const base = process.env.APP_URL ?? "http://localhost:3000";
        const link = `${base}/auth/magic?token=${token}`;

        // The token reaches the queue payload and nothing else: not the audit
        // log, not the request log. The payload is the email's manuscript.
        await queue.enqueue({
          kind: MAGIC_LINK_EMAIL_JOB,
          payload: { to: user.email, link },
          maxAttempts: 5,
        });

        await recordAuditSafely(
          database,
          {
            action: "auth.magic_link.requested",
            entityType: "session",
            actorUserId: user.id,
            clientFingerprint: fingerprint,
          },
          (error) => request.log.error({ error }, "audit write failed"),
        );
      }

      // Identical response either way — the 202 is not an oracle.
      return reply.code(202).send({
        message: "If that address has an account, a sign-in link is on its way.",
      });
    },
  );

  app.post<{ Body: { token: string } }>(
    "/auth/magic/consume",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: { token: { type: "string", minLength: 20, maxLength: 128 } },
        },
      },
    },
    async (request, reply) => {
      const fingerprint = fingerprintFor(request.ip);
      const consumed = await consumeLoginToken(database, request.body.token);

      if (!consumed) {
        await recordAuditSafely(
          database,
          {
            action: "auth.magic_link.rejected",
            entityType: "session",
            clientFingerprint: fingerprint,
          },
          (error) => request.log.error({ error }, "audit write failed"),
        );
        return reply.code(401).send({ error: "That sign-in link is no longer valid." });
      }

      const { token: sessionToken } = await createSession(
        database,
        consumed.userId,
        fingerprint,
      );
      await database.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
        consumed.userId,
      ]);

      const session = await resolveSession(database, sessionToken);

      await recordAuditSafely(
        database,
        {
          action: "auth.magic_link.succeeded",
          entityType: "session",
          entityId: session?.sessionId ?? null,
          actorUserId: consumed.userId,
          sessionId: session?.sessionId ?? null,
          clientFingerprint: fingerprint,
        },
        (error) => request.log.error({ error }, "audit write failed"),
      );

      return reply
        .code(200)
        .header(
          "set-cookie",
          serializeSessionCookie(SESSION_COOKIE, sessionToken, {
            maxAgeSeconds: SESSION_TTL_HOURS * 60 * 60,
          }),
        )
        .send({ ok: true });
    },
  );
};
