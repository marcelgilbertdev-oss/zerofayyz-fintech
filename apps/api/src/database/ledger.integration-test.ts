import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import type Stripe from "stripe";

import { buildApp } from "../app.js";
import type { StripeGateway } from "../payments/stripe.gateway.js";
import { createDatabase, type Database } from "./database.js";
import { migrate } from "./migrate.js";

/**
 * These tests run against a real PostgreSQL instance. The unit suite stubs the
 * database, which means no unit test has ever executed the SQL — including the
 * webhook CTE whose ON CONFLICT clause is the entire idempotency guarantee.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PAYMENT_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const WEBHOOK_SECRET = "whsec_integration";

let database: Database;

function paidEvent(eventId: string): Stripe.Event {
  return {
    id: eventId,
    object: "event",
    api_version: "2026-08-01",
    created: 1_780_000_000,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_integration",
        object: "checkout.session",
        client_reference_id: PAYMENT_ID,
        amount_total: 4_200,
        currency: "usd",
        payment_intent: "pi_test_integration",
        payment_status: "paid",
      },
    },
  } as unknown as Stripe.Event;
}

function stripeStub(event: Stripe.Event): StripeGateway {
  return {
    checkout: { sessions: { create() { throw new Error("unused"); } } },
    webhooks: { constructEvent: () => event },
  } as unknown as StripeGateway;
}

async function deliver(eventId: string) {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const app = buildApp({
    database,
    logger: false,
    stripe: stripeStub(paidEvent(eventId)),
  });

  try {
    return await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=integration",
      },
      payload: JSON.stringify({ id: eventId }),
    });
  } finally {
    // The app owns the shared pool, so close only the server here.
    await app.close();
  }
}

before(async () => {
  await migrate(connectionString);

  database = createDatabase(connectionString);

  const health = await database.checkHealth();
  assert.equal(
    health.operational,
    true,
    `PostgreSQL is not reachable at ${connectionString}. Start it with: docker compose -f infrastructure/docker/compose.yaml up -d postgres`,
  );

  await database.query("TRUNCATE audit_logs, transactions, payments, users CASCADE");
  await database.query(
    `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`,
    [USER_ID, "integration@example.test", "Integration Reviewer"],
  );
  await database.query(
    `
      INSERT INTO payments (id, user_id, amount_minor, currency, status, description)
      VALUES ($1, $2, 4200, 'USD', 'processing', 'Integration checkout')
    `,
    [PAYMENT_ID, USER_ID],
  );
});

after(async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  await database.close();
});

test("the migration runner is idempotent", async () => {
  const second = await migrate(connectionString);

  assert.deepEqual(second.applied, [], "a second run must apply nothing");
  assert.ok(second.skipped.length >= 2, "existing migrations should be recorded");
});

test("a delivered webhook writes the transaction, payment and audit log", async () => {
  const response = await deliver("evt_integration_first");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { received: true, processed: true });

  const payment = await database.query<{ status: string; provider_payment_id: string }>(
    "SELECT status, provider_payment_id FROM payments WHERE id = $1",
    [PAYMENT_ID],
  );
  assert.equal(payment.rows[0]?.status, "succeeded");
  assert.equal(payment.rows[0]?.provider_payment_id, "pi_test_integration");

  const audit = await database.query<{ count: string }>(
    "SELECT COUNT(*)::TEXT AS count FROM audit_logs WHERE entity_id = $1",
    [PAYMENT_ID],
  );
  assert.equal(audit.rows[0]?.count, "1");
});

test("redelivering the same event changes nothing", async () => {
  const response = await deliver("evt_integration_first");

  assert.equal(response.statusCode, 200);
  // Acknowledged so Stripe stops retrying, but reported honestly as unprocessed.
  assert.deepEqual(response.json(), { received: true, processed: false });

  const transactions = await database.query<{ count: string }>(
    "SELECT COUNT(*)::TEXT AS count FROM transactions WHERE payment_id = $1",
    [PAYMENT_ID],
  );
  const audit = await database.query<{ count: string }>(
    "SELECT COUNT(*)::TEXT AS count FROM audit_logs WHERE entity_id = $1",
    [PAYMENT_ID],
  );

  // Stripe retries on any non-2xx and can deliver the same event more than
  // once regardless; a second row here would be a duplicated financial record.
  assert.equal(transactions.rows[0]?.count, "1", "redelivery must not add a transaction");
  assert.equal(audit.rows[0]?.count, "1", "redelivery must not add an audit entry");
});

test("a different event id for the same payment is recorded separately", async () => {
  await deliver("evt_integration_second");

  const transactions = await database.query<{ count: string }>(
    "SELECT COUNT(*)::TEXT AS count FROM transactions WHERE payment_id = $1",
    [PAYMENT_ID],
  );

  assert.equal(transactions.rows[0]?.count, "2");
});

test("GET /api/v1/transactions runs its SQL against real rows", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/transactions" });

  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.equal(body.meta.source, "postgresql");
  // DISTINCT ON collapses the two events down to the latest per payment.
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].customer.email, "integration@example.test");
  assert.equal(body.data[0].amountMinor, 4_200);
  assert.equal(body.data[0].status, "succeeded");
});

test("GET /api/v1/metrics aggregates real rows", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/metrics" });

  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.equal(body.currency, "USD");
  assert.equal(body.grossVolumeMinor, 4_200);
  assert.equal(body.succeededCount, 1);
  assert.equal(body.successRate, 100);
  assert.equal(body.pending.count, 0);
  assert.equal(body.eventsRecorded, 2);
  assert.equal(body.dailyVolume.length, 12);
  assert.equal(body.dailyVolume.at(-1)?.amountMinor, 4_200);
});

test("GET /api/v1/health reports a real database latency", async (context) => {
  const app = buildApp({ database, logger: false, stripe: null });
  context.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/health" });
  const body = response.json();

  assert.equal(body.status, "operational");
  assert.equal(body.checks.database.status, "operational");
  assert.equal(body.checks.database.name, "zerofayyz_fintech");
  assert.equal(typeof body.checks.database.latencyMs, "number");
});
