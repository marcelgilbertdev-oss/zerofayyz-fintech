import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { createDatabase, type Database } from "./database.js";
import { migrate } from "./migrate.js";

/**
 * Row-level security, proved against a real PostgreSQL instance.
 *
 * The claim under test is the one interviewers phrase as "one user can never
 * read another user's rows, even if they call the database directly". Route
 * guards cannot prove that — they are the thing being bypassed. So every
 * query below runs with NO per-user WHERE clause. If a row is absent, it is
 * absent because the database's policy refused it, not because this test
 * remembered to filter.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const RUN = randomUUID().slice(0, 8);

const ALICE = randomUUID();
const BOB = randomUUID();
const ADMIN = randomUUID();
const ALICE_PAYMENT = randomUUID();
const BOB_PAYMENT = randomUUID();
const BOB_SESSION = randomUUID();

let database: Database;

before(async () => {
  process.env.DATABASE_URL = connectionString;
  await migrate();
  database = createDatabase(connectionString);

  await database.query(
    `INSERT INTO users (id, email, display_name, role, password_hash) VALUES
       ($1, $4, 'RLS Alice', 'customer', NULL),
       ($2, $5, 'RLS Bob',   'customer', NULL),
       ($3, $6, 'RLS Admin', 'admin',    'x')`,
    [ALICE, BOB, ADMIN, `rls-a-${RUN}@test`, `rls-b-${RUN}@test`, `rls-adm-${RUN}@test`],
  );
  await database.query(
    `INSERT INTO payments (id, user_id, amount_minor, currency, status) VALUES
       ($1, $3, 1000, 'JPY', 'succeeded'),
       ($2, $4, 2000, 'JPY', 'succeeded')`,
    [ALICE_PAYMENT, BOB_PAYMENT, ALICE, BOB],
  );
  await database.query(
    `INSERT INTO transactions (payment_id, provider_event_id, event_type, amount_minor, currency)
     VALUES ($1, $2, 'payment_succeeded', 2000, 'JPY')`,
    [BOB_PAYMENT, `evt_rls_${RUN}`],
  );
  await database.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')`,
    [BOB_SESSION, BOB, `rls-token-${RUN}`],
  );
});

after(async () => {
  await database.close();
});

test("a customer's unfiltered SELECT returns only their own payments", async () => {
  const rows = await database.queryAsUser(
    { userId: ALICE, role: "customer" },
    async (query) => {
      // Deliberately no user_id predicate. The policy IS the WHERE clause.
      const result = await query<{ id: string }>(
        "SELECT id FROM payments WHERE id = ANY($1::uuid[])",
        [[ALICE_PAYMENT, BOB_PAYMENT]],
      );
      return result.rows.map((row) => row.id);
    },
  );

  assert.deepEqual(rows, [ALICE_PAYMENT]);
});

test("a customer who owns nothing sees nothing — deny is the default", async () => {
  const stranger = randomUUID();
  const count = await database.queryAsUser(
    { userId: stranger, role: "customer" },
    async (query) => {
      const result = await query<{ n: string }>(
        "SELECT COUNT(*)::TEXT AS n FROM payments",
      );
      return Number(result.rows[0]?.n);
    },
  );

  assert.equal(count, 0);
});

test("staff read the whole surface — the policy admits the role, not the SQL", async () => {
  const rows = await database.queryAsUser(
    { userId: ADMIN, role: "viewer" },
    async (query) => {
      const result = await query<{ id: string }>(
        "SELECT id FROM payments WHERE id = ANY($1::uuid[]) ORDER BY amount_minor",
        [[ALICE_PAYMENT, BOB_PAYMENT]],
      );
      return result.rows.map((row) => row.id);
    },
  );

  assert.deepEqual(rows, [ALICE_PAYMENT, BOB_PAYMENT]);
});

test("transactions are visible exactly when their payment is", async () => {
  const asAlice = await database.queryAsUser(
    { userId: ALICE, role: "customer" },
    async (query) => {
      const result = await query(
        "SELECT id FROM transactions WHERE payment_id = $1",
        [BOB_PAYMENT],
      );
      return result.rowCount ?? 0;
    },
  );
  const asBob = await database.queryAsUser(
    { userId: BOB, role: "customer" },
    async (query) => {
      const result = await query(
        "SELECT id FROM transactions WHERE payment_id = $1",
        [BOB_PAYMENT],
      );
      return result.rowCount ?? 0;
    },
  );

  assert.equal(asAlice, 0, "Alice can name Bob's payment id and still get nothing");
  assert.equal(asBob, 1);
});

test("sessions: customers see their own; admins see presence", async () => {
  const asAlice = await database.queryAsUser(
    { userId: ALICE, role: "customer" },
    async (query) => {
      const result = await query("SELECT id FROM sessions WHERE id = $1", [
        BOB_SESSION,
      ]);
      return result.rowCount ?? 0;
    },
  );
  const asAdmin = await database.queryAsUser(
    { userId: ADMIN, role: "admin" },
    async (query) => {
      const result = await query("SELECT id FROM sessions WHERE id = $1", [
        BOB_SESSION,
      ]);
      return result.rowCount ?? 0;
    },
  );

  assert.equal(asAlice, 0);
  assert.equal(asAdmin, 1);
});

test("the request lane cannot write the ledger at all", async () => {
  await assert.rejects(
    database.queryAsUser({ userId: ALICE, role: "customer" }, (query) =>
      query("UPDATE payments SET amount_minor = 1 WHERE id = $1", [
        ALICE_PAYMENT,
      ]),
    ),
    /permission denied/,
    "even their OWN payment: the lane has no UPDATE grant anywhere",
  );
});

test("filing a refund request as somebody else violates the policy", async () => {
  await assert.rejects(
    database.queryAsUser({ userId: ALICE, role: "customer" }, (query) =>
      query(
        `INSERT INTO refund_requests (payment_id, reason, requested_by)
         VALUES ($1, 'forged on behalf of Bob', $2)`,
        [BOB_PAYMENT, BOB],
      ),
    ),
    /row-level security/,
  );
});

test("an unknown role is refused before any SQL runs", async () => {
  await assert.rejects(
    database.queryAsUser(
      { userId: ALICE, role: "superuser" as never },
      async () => "unreachable",
    ),
    /Unknown request-lane role/,
  );
});

test("the context dies with the transaction — the pooled connection comes back clean", async () => {
  // Serialize enough request-lane work to touch every pool connection slot
  // at least plausibly, then prove the service lane still sees everything
  // and no app.user_id survives anywhere.
  for (let i = 0; i < 12; i += 1) {
    await database.queryAsUser({ userId: ALICE, role: "customer" }, (query) =>
      query("SELECT 1"),
    );
  }

  const service = await database.query<{ n: string; leaked: string | null }>(
    `SELECT COUNT(*)::TEXT AS n,
            current_setting('app.user_id', true) AS leaked
       FROM payments WHERE id = ANY($1::uuid[])`,
    [[ALICE_PAYMENT, BOB_PAYMENT]],
  );

  assert.equal(Number(service.rows[0]?.n), 2, "service lane is not scoped");
  const leaked = service.rows[0]?.leaked ?? null;
  assert.ok(!leaked, "transaction-local context must not outlive its transaction");
});

test("a failing request-lane query rolls back and the lane stays usable", async () => {
  await assert.rejects(
    database.queryAsUser({ userId: ALICE, role: "customer" }, (query) =>
      query("SELECT no_such_column FROM payments"),
    ),
  );

  const rows = await database.queryAsUser(
    { userId: ALICE, role: "customer" },
    async (query) => {
      const result = await query<{ id: string }>(
        "SELECT id FROM payments WHERE id = ANY($1::uuid[])",
        [[ALICE_PAYMENT, BOB_PAYMENT]],
      );
      return result.rows.map((row) => row.id);
    },
  );

  assert.deepEqual(rows, [ALICE_PAYMENT]);
});
