import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { buildApp } from "../app.js";
import { createDatabase, type Database } from "../database/database.js";
import { migrate } from "../database/migrate.js";
import { hashPassword } from "./password.js";
import { consumeLoginToken, issueLoginToken, MAGIC_LINK_EMAIL_JOB } from "./magic.js";

/**
 * Passwordless sign-in, proved end to end against real PostgreSQL.
 *
 * The claims a reviewer should demand: the request path is not an enumeration
 * oracle, the email leaves through the queue rather than the request handler,
 * a link works exactly once even when two clicks race, and expiry/disabled
 * are decided in SQL. All concurrency and clock properties — none provable on
 * a stubbed database.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const RUN = randomUUID().slice(0, 8);
const OPERATOR_ID = randomUUID();
const DISABLED_ID = randomUUID();
const OPERATOR_EMAIL = `magic-op-${RUN}@test.example`;
const DISABLED_EMAIL = `magic-off-${RUN}@test.example`;

let database: Database;

before(async () => {
  process.env.DATABASE_URL = connectionString;
  await migrate();
  database = createDatabase(connectionString);

  const hash = await hashPassword("a-magic-surface-test-password", { N: 1_024, r: 8, p: 1 });
  await database.query(
    `INSERT INTO users (id, email, display_name, role, password_hash, disabled_at)
     VALUES ($1, $3, 'Magic Operator', 'operator', $5, NULL),
            ($2, $4, 'Magic Disabled', 'operator', $5, NOW())`,
    [OPERATOR_ID, DISABLED_ID, OPERATOR_EMAIL, DISABLED_EMAIL, hash],
  );
});

after(async () => {
  await database.query("DELETE FROM jobs WHERE kind = $1 AND payload->>'to' LIKE $2", [
    MAGIC_LINK_EMAIL_JOB,
    `magic-%-${RUN}@test.example`,
  ]);
  await database.query("DELETE FROM sessions WHERE user_id = ANY($1::uuid[])", [
    [OPERATOR_ID, DISABLED_ID],
  ]);
  await database.query("DELETE FROM login_tokens WHERE user_id = ANY($1::uuid[])", [
    [OPERATOR_ID, DISABLED_ID],
  ]);
  await database.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
    [OPERATOR_ID, DISABLED_ID],
  ]);
  await database.close();
});

test("a real account gets a token row and an email JOB — never an inline send", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/magic-link",
    payload: { email: OPERATOR_EMAIL },
  });
  assert.equal(response.statusCode, 202);

  const tokens = await database.query<{ n: string }>(
    "SELECT COUNT(*)::TEXT AS n FROM login_tokens WHERE user_id = $1",
    [OPERATOR_ID],
  );
  assert.equal(Number(tokens.rows[0]?.n), 1, "no token row was written");

  const jobs = await database.query<{ payload: { to: string; link: string } }>(
    "SELECT payload FROM jobs WHERE kind = $1 AND payload->>'to' = $2",
    [MAGIC_LINK_EMAIL_JOB, OPERATOR_EMAIL],
  );
  const job = jobs.rows[0];
  assert.ok(job, "the email was not enqueued");
  assert.match(job.payload.link, /\/auth\/magic\?token=/);
  // The link carries the raw token; the database must only ever hold a hash.
  const raw = job.payload.link.split("token=")[1] ?? "";
  const leaked = await database.query<{ n: string }>(
    "SELECT COUNT(*)::TEXT AS n FROM login_tokens WHERE token_hash = $1",
    [raw],
  );
  assert.equal(Number(leaked.rows[0]?.n), 0, "the raw token was stored");
});

test("an unknown address gets the identical 202 and leaves no trace", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const known = await app.inject({
    method: "POST",
    url: "/api/v1/auth/magic-link",
    payload: { email: OPERATOR_EMAIL },
  });
  const unknown = await app.inject({
    method: "POST",
    url: "/api/v1/auth/magic-link",
    payload: { email: `nobody-${RUN}@test.example` },
  });

  assert.equal(unknown.statusCode, 202);
  assert.equal(unknown.body, known.body, "the response differs by account existence");

  const jobs = await database.query<{ n: string }>(
    "SELECT COUNT(*)::TEXT AS n FROM jobs WHERE kind = $1 AND payload->>'to' = $2",
    [MAGIC_LINK_EMAIL_JOB, `nobody-${RUN}@test.example`],
  );
  assert.equal(Number(jobs.rows[0]?.n), 0, "an email job was enqueued for a ghost");
});

test("a valid link signs in: session cookie set, session live", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const { token } = await issueLoginToken(database, OPERATOR_ID, null);
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/magic/consume",
    payload: { token },
  });

  assert.equal(response.statusCode, 200);
  const setCookie = response.headers["set-cookie"];
  assert.ok(setCookie, "no session cookie was set");

  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]!;
  const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, "the magic-link session was not honoured");
});

test("two clicks racing on one link produce exactly one session", async () => {
  const { token } = await issueLoginToken(database, OPERATOR_ID, null);

  const results = await Promise.all(
    Array.from({ length: 6 }, () => consumeLoginToken(database, token)),
  );
  const wins = results.filter((r) => r !== null);
  assert.equal(wins.length, 1, "a single-use token was consumed more than once");
});

test("an expired link is refused — expiry decided in SQL", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const { token } = await issueLoginToken(database, OPERATOR_ID, null);
  await database.query(
    "UPDATE login_tokens SET expires_at = NOW() - INTERVAL '1 second', created_at = NOW() - INTERVAL '1 hour' WHERE user_id = $1 AND used_at IS NULL",
    [OPERATOR_ID],
  );

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/magic/consume",
    payload: { token },
  });
  assert.equal(response.statusCode, 401);
});

test("a disabled account's link is refused even while fresh and unused", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const { token } = await issueLoginToken(database, DISABLED_ID, null);
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/magic/consume",
    payload: { token },
  });
  assert.equal(response.statusCode, 401);
});

test("link requests are rate limited per mailbox", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  // A fresh app means a fresh limiter; the budget is three per window.
  const target = `limited-${RUN}@test.example`;
  for (let i = 0; i < 3; i += 1) {
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: target },
    });
    assert.equal(ok.statusCode, 202);
  }
  const fourth = await app.inject({
    method: "POST",
    url: "/api/v1/auth/magic-link",
    payload: { email: target },
  });
  assert.equal(fourth.statusCode, 429);
  assert.ok(fourth.headers["retry-after"], "429 without retry-after");
});
