import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { buildApp } from "../app.js";
import { createDatabase, type Database } from "../database/database.js";
import { migrate } from "../database/migrate.js";

/**
 * The list endpoints against real PostgreSQL: pagination arithmetic, filter
 * correctness, and the per-customer aggregate — all things a stubbed database
 * asserts nothing about.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const CUSTOMER_ID = "ffffffff-0000-4000-8000-000000000001";
// GBP so these rows are invisible to every USD-scoped assertion other suites
// make — the same currency isolation the refund suite uses with EUR.
const PAYMENTS = [
  { id: "ffffffff-0000-4000-8000-000000000101", amount: 1_000, status: "succeeded" },
  { id: "ffffffff-0000-4000-8000-000000000102", amount: 2_000, status: "succeeded" },
  { id: "ffffffff-0000-4000-8000-000000000103", amount: 4_000, status: "failed" },
  { id: "ffffffff-0000-4000-8000-000000000104", amount: 8_000, status: "processing" },
] as const;

let database: Database;

before(async () => {
  await migrate(connectionString);
  database = createDatabase(connectionString);

  await database.query("DELETE FROM transactions WHERE payment_id = ANY($1)", [
    PAYMENTS.map((payment) => payment.id),
  ]);
  await database.query("DELETE FROM payments WHERE id = ANY($1)", [
    PAYMENTS.map((payment) => payment.id),
  ]);
  await database.query("DELETE FROM users WHERE id = $1", [CUSTOMER_ID]);

  await database.query(
    `INSERT INTO users (id, email, display_name) VALUES ($1, 'ledger.list@zerofayyz.test', 'Ledger Lister')`,
    [CUSTOMER_ID],
  );

  for (const [index, payment] of PAYMENTS.entries()) {
    await database.query(
      `
        INSERT INTO payments (id, user_id, amount_minor, currency, status, description, created_at)
        VALUES ($1, $2, $3, 'GBP', $4, 'List suite payment', NOW() - ($5 || ' minutes')::INTERVAL)
      `,
      [payment.id, CUSTOMER_ID, payment.amount, payment.status, String(index)],
    );
  }

  await database.query(
    `
      INSERT INTO transactions (payment_id, provider_event_id, event_type, amount_minor, currency, occurred_at)
      VALUES ($1, 'evt_list_suite_1', 'payment_succeeded', 1000, 'GBP', NOW())
      ON CONFLICT (provider_event_id) DO NOTHING
    `,
    [PAYMENTS[0].id],
  );
});

after(async () => {
  await database.query("DELETE FROM transactions WHERE payment_id = ANY($1)", [
    PAYMENTS.map((payment) => payment.id),
  ]);
  await database.query("DELETE FROM payments WHERE id = ANY($1)", [
    PAYMENTS.map((payment) => payment.id),
  ]);
  await database.query("DELETE FROM users WHERE id = $1", [CUSTOMER_ID]);
  await database.close();
});

test("payments paginate with an exact total that follows the filter", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const firstPage = await app.inject({ method: "GET", url: "/api/v1/payments?limit=2&offset=0" });
  assert.equal(firstPage.statusCode, 200);
  const first = firstPage.json();
  assert.equal(first.data.length, 2);
  assert.ok(first.meta.total >= PAYMENTS.length, "total sees every payment");

  // The second page must not repeat the first — deterministic ordering, which
  // is why the ORDER BY carries the id as a tiebreaker.
  const secondPage = await app.inject({ method: "GET", url: "/api/v1/payments?limit=2&offset=2" });
  const firstIds = new Set(first.data.map((row: { id: string }) => row.id));
  for (const row of secondPage.json().data as Array<{ id: string }>) {
    assert.equal(firstIds.has(row.id), false, "page two repeated a row from page one");
  }

  // A filtered list's total describes the filtered set, not the table.
  const failed = await app.inject({ method: "GET", url: "/api/v1/payments?status=failed" });
  const failedBody = failed.json();
  assert.ok(failedBody.data.length >= 1);
  for (const row of failedBody.data as Array<{ status: string }>) {
    assert.equal(row.status, "failed");
  }
  assert.equal(failedBody.meta.total, failedBody.data.length <= failedBody.meta.limit ? failedBody.data.length : failedBody.meta.total);
});

test("an invalid status filter is refused by the schema, not silently ignored", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/payments?status=exploded" });
  assert.equal(response.statusCode, 400);
});

test("the event stream exposes provider event ids", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/events?limit=100" });
  assert.equal(response.statusCode, 200);

  const rows = response.json().data as Array<{ providerEventId: string | null }>;
  assert.ok(
    rows.some((row) => row.providerEventId === "evt_list_suite_1"),
    "the suite's own event id is visible in the stream",
  );
});

test("customers aggregate counts every payment but sums only settled money", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/customers?limit=100" });
  assert.equal(response.statusCode, 200);

  const me = (response.json().data as Array<{
    email: string;
    paymentCount: number;
    succeededVolumeMinor: number;
  }>).find((row) => row.email === "ledger.list@zerofayyz.test");

  assert.ok(me, "the suite's customer is listed");
  assert.equal(me?.paymentCount, 4);
  // GBP on purpose: the volume column is USD-scoped like /metrics, so these
  // succeeded GBP payments must NOT appear in it — summing across currencies
  // is the bug, and this asserts its absence.
  assert.equal(me?.succeededVolumeMinor, 0);
});
