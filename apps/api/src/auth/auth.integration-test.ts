import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import { buildApp } from "../app.js";
import { createDatabase, type Database } from "../database/database.js";
import { migrate } from "../database/migrate.js";
import { hashPassword } from "./password.js";
import { SESSION_COOKIE } from "./sessions.js";

/**
 * Authentication against a real PostgreSQL instance.
 *
 * The stubbed unit suite cannot see the constraints, the append-only trigger,
 * or the SQL that decides whether a session is still valid — and those are the
 * parts that actually enforce anything.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const ADMIN_ID = "cccccccc-0000-4000-8000-000000000001";
const VIEWER_ID = "cccccccc-0000-4000-8000-000000000002";
const PASSWORD = "a-long-enough-demo-password";

let database: Database;

async function seedStaff() {
  const hash = await hashPassword(PASSWORD, { N: 1_024, r: 8, p: 1 });

  await database.query("DELETE FROM sessions WHERE user_id = ANY($1)", [
    [ADMIN_ID, VIEWER_ID],
  ]);
  await database.query(
    `
      INSERT INTO users (id, email, display_name, role, password_hash)
      VALUES ($1, $2, 'Integration Admin', 'admin', $4),
             ($3, $5, 'Integration Viewer', 'viewer', $4)
      ON CONFLICT (id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role
    `,
    [
      ADMIN_ID,
      "integration.admin@zerofayyz.test",
      VIEWER_ID,
      hash,
      "integration.viewer@zerofayyz.test",
    ],
  );
}

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(header, "expected a Set-Cookie header");
  return header.split(";")[0] ?? "";
}

before(async () => {
  await migrate(connectionString);
  database = createDatabase(connectionString);
  await seedStaff();
});

beforeEach(async () => {
  await database.query("DELETE FROM sessions WHERE user_id = ANY($1)", [
    [ADMIN_ID, VIEWER_ID],
  ]);
});

after(async () => {
  await database.query("DELETE FROM sessions WHERE user_id = ANY($1)", [
    [ADMIN_ID, VIEWER_ID],
  ]);
  await database.close();
});

test("a correct password issues a session cookie with the protective attributes", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "integration.admin@zerofayyz.test", password: PASSWORD },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.role, "admin");

  const header = response.headers["set-cookie"];
  const cookie = Array.isArray(header) ? header[0] : header;
  assert.ok(cookie?.includes("HttpOnly"));
  assert.ok(cookie?.includes("Secure"));
  assert.ok(cookie?.includes("SameSite=Lax"));
});

test("the raw session token is never stored", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "integration.admin@zerofayyz.test", password: PASSWORD },
  });

  const token = sessionCookie(response.headers["set-cookie"]).split("=")[1] ?? "";
  assert.ok(token.length > 20);

  // A database dump must not hand anyone a usable session.
  const stored = await database.query<{ token_hash: string }, [string]>(
    "SELECT token_hash FROM sessions WHERE user_id = $1",
    [ADMIN_ID],
  );
  assert.equal(stored.rows.length, 1);
  assert.notEqual(stored.rows[0]?.token_hash, decodeURIComponent(token));
});

test("a wrong password is refused and a missing account looks identical", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const wrongPassword = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "integration.admin@zerofayyz.test", password: "not it" },
  });
  const noSuchUser = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "nobody@zerofayyz.test", password: "not it" },
  });

  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(noSuchUser.statusCode, 401);
  // Identical bodies: a different message for each is an account-enumeration
  // oracle dressed up as a helpful error.
  assert.deepEqual(wrongPassword.json(), noSuchUser.json());
});

test("/auth/me is 401 without a cookie and returns the user with one", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  assert.equal((await app.inject({ method: "GET", url: "/api/v1/auth/me" })).statusCode, 401);

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "integration.viewer@zerofayyz.test", password: PASSWORD },
  });
  const me = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { cookie: sessionCookie(login.headers["set-cookie"]) },
  });

  assert.equal(me.statusCode, 200);
  assert.equal(me.json().role, "viewer");
});

test("logout revokes the session, and the old cookie stops working", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "integration.admin@zerofayyz.test", password: PASSWORD },
  });
  const cookie = sessionCookie(login.headers["set-cookie"]);

  await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } });

  // The revocation lives in the database, so replaying the cookie fails even
  // though the cookie itself is unchanged and unexpired.
  const replay = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { cookie },
  });
  assert.equal(replay.statusCode, 401);
});

test("an expired session is refused without anyone deleting it", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "integration.admin@zerofayyz.test", password: PASSWORD },
  });
  const cookie = sessionCookie(login.headers["set-cookie"]);

  // Backdate creation as well as expiry. The table enforces
  // `expires_at > created_at`, so a row that expired before it was created is
  // a state the schema refuses to represent — and the first draft of this test
  // tried to write exactly that. Aging the whole row models what actually
  // happens: a session made two hours ago that lapsed an hour ago.
  await database.query(
    `
      UPDATE sessions
         SET created_at = NOW() - INTERVAL '2 hours',
             expires_at = NOW() - INTERVAL '1 hour'
       WHERE user_id = $1
    `,
    [ADMIN_ID],
  );

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { cookie },
  });
  assert.equal(response.statusCode, 401);
});

test("a forged cookie authenticates nobody", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  for (const forged of ["", "not-a-token", "a".repeat(43), "../../etc/passwd"]) {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: `${SESSION_COOKIE}=${forged}` },
    });
    assert.equal(response.statusCode, 401, `forged token ${JSON.stringify(forged)} was accepted`);
  }
});

test("the audit log records the login and cannot be edited afterwards", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "integration.admin@zerofayyz.test", password: PASSWORD },
  });

  const entries = await database.query<{ action: string }, [string]>(
    "SELECT action FROM audit_logs WHERE actor_user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [ADMIN_ID],
  );
  assert.equal(entries.rows[0]?.action, "auth.login.succeeded");

  // The trigger, not the application, is what makes this evidence.
  await assert.rejects(
    () =>
      database.query("UPDATE audit_logs SET action = 'tampered' WHERE actor_user_id = $1", [
        ADMIN_ID,
      ]),
    /append-only/,
  );
  await assert.rejects(
    () => database.query("DELETE FROM audit_logs WHERE actor_user_id = $1", [ADMIN_ID]),
    /append-only/,
  );
});

test("a failed login records the attempt but never the password", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const secret = "unique-password-that-must-not-be-logged-9f2a";

  await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "integration.viewer@zerofayyz.test", password: secret },
  });

  const entries = await database.query<{ metadata: unknown }>(
    `
      SELECT metadata FROM audit_logs
       WHERE action = 'auth.login.failed'
       ORDER BY created_at DESC LIMIT 5
    `,
  );

  const serialized = JSON.stringify(entries.rows);
  assert.ok(serialized.includes("integration.viewer@zerofayyz.test"));
  assert.equal(serialized.includes(secret), false, "the attempted password was written to the audit log");
});

test("the database refuses a staff account with no password", async () => {
  // The constraint is the guarantee, not the code path that happens to insert.
  await assert.rejects(
    () =>
      database.query(
        `INSERT INTO users (email, display_name, role) VALUES ($1, 'No Password', 'admin')`,
        ["broken.admin@zerofayyz.test"],
      ),
    /users_staff_have_credentials/,
  );
});
