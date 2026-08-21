import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import { buildApp } from "../app.js";
import { hashPassword } from "../auth/password.js";
import { createDatabase, type Database } from "../database/database.js";
import { migrate } from "../database/migrate.js";

/**
 * The admin surface, exercised through real requests against real rows.
 *
 * The interesting assertions are the refusals: a viewer reading the audit log
 * or an anonymous request listing sessions would each be a working privilege
 * escalation, and only a test that makes the actual request can prove the
 * guard is wired to the route rather than merely written next to it.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const ADMIN_ID = "dddddddd-0000-4000-8000-000000000001";
const OPERATOR_ID = "dddddddd-0000-4000-8000-000000000002";
const VIEWER_ID = "dddddddd-0000-4000-8000-000000000003";
const PASSWORD = "an-admin-surface-test-password";
const STAFF = [ADMIN_ID, OPERATOR_ID, VIEWER_ID];

let database: Database;

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(header, "expected a Set-Cookie header");
  return header.split(";")[0] ?? "";
}

async function login(
  app: ReturnType<typeof buildApp>,
  email: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `login as ${email} failed`);
  return sessionCookie(response.headers["set-cookie"]);
}

before(async () => {
  await migrate(connectionString);
  database = createDatabase(connectionString);

  const hash = await hashPassword(PASSWORD, { N: 1_024, r: 8, p: 1 });

  await database.query(
    `
      INSERT INTO users (id, email, display_name, role, password_hash)
      VALUES ($1, 'surface.admin@zerofayyz.test', 'Surface Admin', 'admin', $4),
             ($2, 'surface.operator@zerofayyz.test', 'Surface Operator', 'operator', $4),
             ($3, 'surface.viewer@zerofayyz.test', 'Surface Viewer', 'viewer', $4)
      ON CONFLICT (id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role
    `,
    [ADMIN_ID, OPERATOR_ID, VIEWER_ID, hash],
  );
});

beforeEach(async () => {
  await database.query("DELETE FROM sessions WHERE user_id = ANY($1)", [STAFF]);
});

after(async () => {
  await database.query("DELETE FROM sessions WHERE user_id = ANY($1)", [STAFF]);
  await database.close();
});

test("every admin route refuses an anonymous request", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  for (const [method, url] of [
    ["GET", "/api/v1/admin/sessions"],
    ["GET", "/api/v1/admin/audit-logs"],
    ["GET", "/api/v1/admin/users"],
    ["DELETE", "/api/v1/admin/sessions/dddddddd-0000-4000-8000-00000000ffff"],
  ] as const) {
    const response = await app.inject({ method, url });
    assert.equal(response.statusCode, 401, `${method} ${url} answered an anonymous request`);
  }
});

test("a viewer is refused everywhere on the admin surface", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const cookie = await login(app, "surface.viewer@zerofayyz.test");

  for (const [method, url] of [
    ["GET", "/api/v1/admin/sessions"],
    ["GET", "/api/v1/admin/audit-logs"],
    ["GET", "/api/v1/admin/users"],
  ] as const) {
    const response = await app.inject({ method, url, headers: { cookie } });
    assert.equal(response.statusCode, 403, `${method} ${url} let a viewer in`);
  }
});

test("an operator reads the audit log but not sessions or users", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const cookie = await login(app, "surface.operator@zerofayyz.test");

  const audit = await app.inject({
    method: "GET",
    url: "/api/v1/admin/audit-logs",
    headers: { cookie },
  });
  assert.equal(audit.statusCode, 200);
  assert.ok(Array.isArray(audit.json().data));

  for (const url of ["/api/v1/admin/sessions", "/api/v1/admin/users"]) {
    const response = await app.inject({ method: "GET", url, headers: { cookie } });
    assert.equal(response.statusCode, 403, `${url} let an operator in`);
  }
});

test("an admin sees the live presence list, with their own session marked", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const adminCookie = await login(app, "surface.admin@zerofayyz.test");
  await login(app, "surface.viewer@zerofayyz.test");

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/admin/sessions",
    headers: { cookie: adminCookie },
  });

  assert.equal(response.statusCode, 200);
  const rows = response.json().data as Array<{
    email: string;
    current: boolean;
    clientFingerprint: string | null;
  }>;

  const admin = rows.find((row) => row.email === "surface.admin@zerofayyz.test");
  const viewer = rows.find((row) => row.email === "surface.viewer@zerofayyz.test");

  assert.ok(admin, "the admin's own session is missing from presence");
  assert.ok(viewer, "the viewer's session is missing from presence");
  assert.equal(admin?.current, true);
  assert.equal(viewer?.current, false);

  // The privacy rule, asserted where the data leaves the system: whatever the
  // fingerprint is, it is not an IP address.
  for (const row of rows) {
    if (row.clientFingerprint !== null) {
      assert.doesNotMatch(row.clientFingerprint, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    }
  }
});

test("revoking a session signs its holder out immediately", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const adminCookie = await login(app, "surface.admin@zerofayyz.test");
  const viewerCookie = await login(app, "surface.viewer@zerofayyz.test");

  const presence = await app.inject({
    method: "GET",
    url: "/api/v1/admin/sessions",
    headers: { cookie: adminCookie },
  });
  const viewerSession = (presence.json().data as Array<{ id: string; email: string }>).find(
    (row) => row.email === "surface.viewer@zerofayyz.test",
  );
  assert.ok(viewerSession);

  const revoke = await app.inject({
    method: "DELETE",
    url: `/api/v1/admin/sessions/${viewerSession?.id}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(revoke.statusCode, 200);

  // The viewer's unexpired, unchanged cookie now opens nothing.
  const afterRevoke = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { cookie: viewerCookie },
  });
  assert.equal(afterRevoke.statusCode, 401);

  // Revoking the same session twice is a 404, not a silent success — the
  // second admin should learn it was already gone.
  const again = await app.inject({
    method: "DELETE",
    url: `/api/v1/admin/sessions/${viewerSession?.id}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(again.statusCode, 404);

  // And the forced sign-out is in the history, attributed to the admin.
  const entries = await database.query<{ actor_user_id: string | null }>(
    "SELECT actor_user_id FROM audit_logs WHERE action = 'admin.session.revoked' ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(entries.rows[0]?.actor_user_id, ADMIN_ID);
});

test("the users list counts payments per customer", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const cookie = await login(app, "surface.admin@zerofayyz.test");
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/admin/users",
    headers: { cookie },
  });

  assert.equal(response.statusCode, 200);
  const rows = response.json().data as Array<{ email: string; paymentCount: number }>;
  assert.ok(rows.length > 0);

  for (const row of rows) {
    assert.equal(typeof row.paymentCount, "number");
  }
});
