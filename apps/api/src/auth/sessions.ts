import { createHash, createHmac, randomBytes } from "node:crypto";

import type { Database } from "../database/database.js";

/**
 * Opaque server-side sessions rather than self-contained tokens.
 *
 * A JWT cannot be revoked before it expires: once issued, every server will
 * honour it until the clock runs out, which makes "log everyone out now" and
 * "show me who is signed in" both impossible without inventing a second store
 * to track the tokens you claimed not to need. A payments platform wants both
 * of those, so the session lives in the database and the cookie carries a
 * random pointer to it.
 */
export const SESSION_COOKIE = "zf_session";
export const SESSION_TTL_HOURS = 12;

const TOKEN_BYTES = 32;

export type SessionRole = "viewer" | "operator" | "admin";

export type AuthenticatedSession = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  role: SessionRole;
};

/** SHA-256 of the cookie value. Only this ever reaches the database. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A stable, non-identifying marker for the client.
 *
 * Keyed with a server secret and truncated to the network prefix, so it can
 * distinguish two sessions and feed a rate limiter, and cannot be reversed
 * into an address or correlated against any other dataset. Strangers log into
 * this demo; retaining their IPs would be collecting more than the job needs.
 */
export function clientFingerprint(
  ip: string | undefined,
  secret: string,
): string | null {
  if (!ip) {
    return null;
  }

  // Node reports IPv4 over IPv6 sockets as "::ffff:203.0.113.7". Unwrapped
  // first, because the colon test below would otherwise classify every such
  // address as IPv6 and slice them all to the same "::ffff" — one fingerprint
  // for the entire IPv4 internet.
  const unwrapped = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

  // IPv4 → first three octets. IPv6 → the /48 routing prefix. The host part is
  // discarded before anything is stored.
  const prefix = unwrapped.includes(":")
    ? unwrapped.split(":").slice(0, 3).join(":")
    : unwrapped.split(".").slice(0, 3).join(".");

  return createHmac("sha256", secret).update(prefix).digest("hex").slice(0, 32);
}

type SessionRow = {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: SessionRole;
};

export async function createSession(
  database: Database,
  userId: string,
  fingerprint: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  await database.query(
    `
      INSERT INTO sessions (user_id, token_hash, expires_at, client_fingerprint)
      VALUES ($1, $2, $3, $4)
    `,
    [userId, hashToken(token), expiresAt.toISOString(), fingerprint],
  );

  return { token, expiresAt };
}

/**
 * Resolves a cookie value to the person holding it, or null.
 *
 * Expiry and revocation are decided in SQL rather than in JavaScript, so a
 * session cannot be honoured by a server whose clock has drifted, and so
 * "revoked" means the same thing to every process reading the table.
 */
export async function resolveSession(
  database: Database,
  token: string | undefined,
): Promise<AuthenticatedSession | null> {
  if (!token) {
    return null;
  }

  const result = await database.query<SessionRow, [string]>(
    `
      UPDATE sessions
         SET last_seen_at = NOW()
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
      RETURNING
        id AS session_id,
        user_id,
        (SELECT email FROM users WHERE users.id = sessions.user_id) AS email,
        (SELECT display_name FROM users WHERE users.id = sessions.user_id) AS display_name,
        (SELECT role FROM users WHERE users.id = sessions.user_id) AS role
    `,
    [hashToken(token)],
  );

  const row = result.rows[0];

  if (!row || row.role === null) {
    return null;
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

export async function revokeSession(
  database: Database,
  token: string,
): Promise<boolean> {
  const result = await database.query(
    `
      UPDATE sessions
         SET revoked_at = NOW()
       WHERE token_hash = $1
         AND revoked_at IS NULL
    `,
    [hashToken(token)],
  );

  return (result.rowCount ?? 0) > 0;
}
