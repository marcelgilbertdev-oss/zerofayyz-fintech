import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import type Stripe from "stripe";

import { buildApp } from "../app.js";
import { hashPassword } from "../auth/password.js";
import { createDatabase, type Database } from "../database/database.js";
import { migrate } from "../database/migrate.js";
import type { StripeGateway } from "../payments/stripe.gateway.js";

/**
 * The refund workflow against real PostgreSQL, with Stripe stubbed at the
 * gateway seam. The four-eyes rule, the one-pending-per-payment index, and the
 * decided-requests-are-complete constraint all live in the schema, and only a
 * real database can refuse anything.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const ADMIN_ID = "eeeeeeee-0000-4000-8000-000000000001";
const OPERATOR_ID = "eeeeeeee-0000-4000-8000-000000000002";
const SECOND_ADMIN_ID = "eeeeeeee-0000-4000-8000-000000000003";
const CUSTOMER_ID = "eeeeeeee-0000-4000-8000-000000000010";
const PAYMENT_ID = "eeeeeeee-0000-4000-8000-000000000020";
const PASSWORD = "a-refund-suite-password";
const STAFF = [ADMIN_ID, OPERATOR_ID, SECOND_ADMIN_ID];

let database: Database;

function stripeStub(created: Array<Record<string, unknown>>): StripeGateway {
  return {
    checkout: {} as Stripe["checkout"],
    refunds: {
      async create(parameters: Record<string, unknown>, options: Record<string, unknown>) {
        created.push({ parameters, options });
        return { id: `re_test_${created.length}` };
      },
    } as unknown as Stripe["refunds"],
    webhooks: {
      constructEvent() {
        throw new Error("Unexpected webhook call");
      },
    } as unknown as Stripe["webhooks"],
  };
}

function cookieOf(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(header);
  return header.split(";")[0] ?? "";
}

async function login(app: ReturnType<typeof buildApp>, email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `login as ${email} failed`);
  return cookieOf(response.headers["set-cookie"]);
}

before(async () => {
  await migrate(connectionString);
  database = createDatabase(connectionString);

  const hash = await hashPassword(PASSWORD, { N: 1_024, r: 8, p: 1 });

  await database.query(
    `
      INSERT INTO users (id, email, display_name, role, password_hash)
      VALUES ($1, 'refund.admin@zerofayyz.test', 'Refund Admin', 'admin', $4),
             ($2, 'refund.operator@zerofayyz.test', 'Refund Operator', 'operator', $4),
             ($3, 'refund.admin2@zerofayyz.test', 'Second Admin', 'admin', $4)
      ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
    `,
    [ADMIN_ID, OPERATOR_ID, SECOND_ADMIN_ID, hash],
  );
  await database.query(
    `
      INSERT INTO users (id, email, display_name, role)
      VALUES ($1, 'refund.customer@zerofayyz.test', 'Refund Customer', 'customer')
      ON CONFLICT (id) DO NOTHING
    `,
    [CUSTOMER_ID],
  );
});

beforeEach(async () => {
  await database.query("DELETE FROM refund_requests WHERE payment_id = $1", [PAYMENT_ID]);
  await database.query("DELETE FROM transactions WHERE payment_id = $1", [PAYMENT_ID]);
  await database.query("DELETE FROM payments WHERE id = $1", [PAYMENT_ID]);
  await database.query(
    `
      INSERT INTO payments (id, user_id, amount_minor, currency, status, provider_payment_id, description)
      -- EUR on purpose: the metrics endpoint aggregates one currency (USD), and
      -- test files run in parallel against one database. A USD payment here
      -- leaks into the ledger suite's gross-volume assertion; a EUR payment is
      -- invisible to it by the same currency-scoping the metrics document.
      VALUES ($1, $2, 13742, 'EUR', 'succeeded', 'pi_refund_suite', 'Refund suite payment')
    `,
    [PAYMENT_ID, CUSTOMER_ID],
  );
  await database.query("DELETE FROM sessions WHERE user_id = ANY($1)", [STAFF]);
});

after(async () => {
  await database.query("DELETE FROM refund_requests WHERE payment_id = $1", [PAYMENT_ID]);
  await database.query("DELETE FROM transactions WHERE payment_id = $1", [PAYMENT_ID]);
  await database.query("DELETE FROM payments WHERE id = $1", [PAYMENT_ID]);
  await database.query("DELETE FROM sessions WHERE user_id = ANY($1)", [STAFF]);
  await database.close();
});

test("an operator requests, an admin approves, and Stripe is called exactly once", async (context) => {
  const stripeCalls: Array<Record<string, unknown>> = [];
  const app = buildApp({ database, logger: false, stripe: stripeStub(stripeCalls) });
  context.after(async () => app.close());

  const operatorCookie = await login(app, "refund.operator@zerofayyz.test");
  const requested = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie: operatorCookie },
    payload: { reason: "Customer asked politely", amountMinor: 5000 },
  });
  assert.equal(requested.statusCode, 201);
  const requestId = requested.json().id as string;

  const adminCookie = await login(app, "refund.admin@zerofayyz.test");
  const approved = await app.inject({
    method: "POST",
    url: `/api/v1/admin/refund-requests/${requestId}/approve`,
    headers: { cookie: adminCookie },
    payload: {},
  });
  assert.equal(approved.statusCode, 200);
  assert.equal(stripeCalls.length, 1);

  const call = stripeCalls[0] as {
    parameters: { payment_intent: string; amount?: number };
    options: { idempotencyKey: string };
  };
  assert.equal(call.parameters.payment_intent, "pi_refund_suite");
  assert.equal(call.parameters.amount, 5000);
  // Retried approvals must not refund twice; Stripe dedupes on this key.
  assert.equal(call.options.idempotencyKey, `refund-request-${requestId}`);

  const stored = await database.query<{ status: string; provider_refund_id: string }>(
    "SELECT status, provider_refund_id FROM refund_requests WHERE id = $1",
    [requestId],
  );
  assert.equal(stored.rows[0]?.status, "approved");
  assert.equal(stored.rows[0]?.provider_refund_id, "re_test_1");
});

test("nobody approves their own request — API answer and schema constraint both", async (context) => {
  const stripeCalls: Array<Record<string, unknown>> = [];
  const app = buildApp({ database, logger: false, stripe: stripeStub(stripeCalls) });
  context.after(async () => app.close());

  // An admin CAN request a refund (they hold operator powers and more)...
  const adminCookie = await login(app, "refund.admin@zerofayyz.test");
  const requested = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie: adminCookie },
    payload: { reason: "Admin-raised request" },
  });
  assert.equal(requested.statusCode, 201);
  const requestId = requested.json().id as string;

  // ...but the same admin cannot then approve it.
  const selfApprove = await app.inject({
    method: "POST",
    url: `/api/v1/admin/refund-requests/${requestId}/approve`,
    headers: { cookie: adminCookie },
    payload: {},
  });
  assert.equal(selfApprove.statusCode, 403);
  assert.equal(stripeCalls.length, 0, "Stripe was called for a refused approval");

  // The schema enforces the same rule for any path that bypasses the API.
  await assert.rejects(
    () =>
      database.query(
        `UPDATE refund_requests SET status='approved', decided_by=$2, decided_at=NOW() WHERE id=$1`,
        [requestId, ADMIN_ID],
      ),
    /refund_decider_is_not_requester/,
  );

  // A different admin may approve it.
  const secondCookie = await login(app, "refund.admin2@zerofayyz.test");
  const approved = await app.inject({
    method: "POST",
    url: `/api/v1/admin/refund-requests/${requestId}/approve`,
    headers: { cookie: secondCookie },
    payload: {},
  });
  assert.equal(approved.statusCode, 200);
});

test("one pending request per payment, enforced by the index", async (context) => {
  const app = buildApp({ database, logger: false, stripe: stripeStub([]) });
  context.after(async () => app.close());

  const cookie = await login(app, "refund.operator@zerofayyz.test");

  const first = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie },
    payload: { reason: "First request" },
  });
  assert.equal(first.statusCode, 201);

  const second = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie },
    payload: { reason: "Second request, same payment" },
  });
  assert.equal(second.statusCode, 409);
});

test("a refund can be requested only against a succeeded payment, and never for more than it", async (context) => {
  const app = buildApp({ database, logger: false, stripe: stripeStub([]) });
  context.after(async () => app.close());

  const cookie = await login(app, "refund.operator@zerofayyz.test");

  const tooMuch = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie },
    payload: { reason: "Refund more than paid", amountMinor: 999999 },
  });
  assert.equal(tooMuch.statusCode, 400);

  await database.query("UPDATE payments SET status='processing' WHERE id=$1", [PAYMENT_ID]);
  const notSettled = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie },
    payload: { reason: "Not settled yet" },
  });
  assert.equal(notSettled.statusCode, 409);
});

test("a viewer may not even read the refund queue", async (context) => {
  const app = buildApp({ database, logger: false, stripe: stripeStub([]) });
  context.after(async () => app.close());

  await database.query(
    "UPDATE users SET role='viewer' WHERE id=$1",
    [OPERATOR_ID],
  );

  try {
    const cookie = await login(app, "refund.operator@zerofayyz.test");
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/admin/refund-requests",
      headers: { cookie },
    });
    assert.equal(listed.statusCode, 403);
  } finally {
    await database.query("UPDATE users SET role='operator' WHERE id=$1", [OPERATOR_ID]);
  }
});

test("the charge.refunded webhook updates the ledger idempotently", async (context) => {
  const event = {
    id: "evt_refund_integration",
    object: "event",
    api_version: "2026-08-01",
    created: 1_780_000_500,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_refund_integration",
        object: "charge",
        payment_intent: "pi_refund_suite",
        amount_refunded: 13742,
        refunded: true,
        currency: "eur",
      },
    },
  } as unknown as Stripe.Event;

  const stripe = {
    checkout: {} as Stripe["checkout"],
    refunds: {} as Stripe["refunds"],
    webhooks: {
      constructEvent: () => event,
    } as unknown as Stripe["webhooks"],
  };
  const app = buildApp({ database, logger: false, stripe });
  context.after(async () => app.close());

  process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_refund_integration";

  const deliver = () =>
    app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: { "stripe-signature": "sig", "content-type": "application/json" },
      payload: JSON.stringify(event),
    });

  const first = await deliver();
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().processed, true);

  const payment = await database.query<{ status: string }>(
    "SELECT status FROM payments WHERE id=$1",
    [PAYMENT_ID],
  );
  assert.equal(payment.rows[0]?.status, "refunded");

  // Redelivery: acknowledged, nothing written twice.
  const second = await deliver();
  assert.equal(second.json().processed, false);

  const rows = await database.query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM transactions WHERE provider_event_id='evt_refund_integration'",
  );
  assert.equal(rows.rows[0]?.count, "1");
});

test("a requester withdraws their own pending request; nobody else can", async (context) => {
  const app = buildApp({ database, logger: false, stripe: stripeStub([]) });
  context.after(async () => app.close());

  const operatorCookie = await login(app, "refund.operator@zerofayyz.test");
  const requested = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie: operatorCookie },
    payload: { reason: "Changed my mind shortly" },
  });
  const requestId = requested.json().id as string;

  // Another staff member cannot withdraw it — withdrawal is the requester's
  // own decision, exactly inverted from approval.
  const adminCookie = await login(app, "refund.admin@zerofayyz.test");
  const notYours = await app.inject({
    method: "POST",
    url: `/api/v1/admin/refund-requests/${requestId}/withdraw`,
    headers: { cookie: adminCookie },
  });
  assert.equal(notYours.statusCode, 404);

  const withdrawn = await app.inject({
    method: "POST",
    url: `/api/v1/admin/refund-requests/${requestId}/withdraw`,
    headers: { cookie: operatorCookie },
  });
  assert.equal(withdrawn.statusCode, 200);

  // The slot reopens: a new request for the same payment is accepted.
  const again = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie: operatorCookie },
    payload: { reason: "Second thoughts, second request" },
  });
  assert.equal(again.statusCode, 201);

  // And a withdrawn request cannot be approved afterwards.
  const late = await app.inject({
    method: "POST",
    url: `/api/v1/admin/refund-requests/${requestId}/approve`,
    headers: { cookie: adminCookie },
    payload: {},
  });
  assert.equal(late.statusCode, 404);
});

test("an approval arriving after a rejection is refused, and Stripe is never called", async (context) => {
  const stripeCalls: Array<Record<string, unknown>> = [];
  const app = buildApp({ database, logger: false, stripe: stripeStub(stripeCalls) });
  context.after(async () => app.close());

  const operatorCookie = await login(app, "refund.operator@zerofayyz.test");
  const requested = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie: operatorCookie },
    payload: { reason: "Raced decision" },
  });
  const requestId = requested.json().id as string;

  const adminCookie = await login(app, "refund.admin@zerofayyz.test");
  await app.inject({
    method: "POST",
    url: `/api/v1/admin/refund-requests/${requestId}/reject`,
    headers: { cookie: adminCookie },
    payload: { note: "Rejected first" },
  });

  // The race, sequentially: the second decider must lose cleanly. The first
  // version of this route would have called Stripe here and overwritten the
  // rejection with an approval.
  const secondCookie = await login(app, "refund.admin2@zerofayyz.test");
  const late = await app.inject({
    method: "POST",
    url: `/api/v1/admin/refund-requests/${requestId}/approve`,
    headers: { cookie: secondCookie },
    payload: {},
  });

  assert.equal(late.statusCode, 404);
  assert.equal(stripeCalls.length, 0, "Stripe was called for an already-decided request");

  const stored = await database.query<{ status: string }>(
    "SELECT status FROM refund_requests WHERE id = $1",
    [requestId],
  );
  assert.equal(stored.rows[0]?.status, "rejected", "the rejection was overwritten");
});

test("a Stripe failure releases the claim so the request can be decided again", async (context) => {
  const failingStripe = {
    ...stripeStub([]),
    refunds: {
      async create() {
        // Shaped like a real Stripe error so the assertion below covers the
        // path that actually matters: the operator learning WHY.
        throw Object.assign(new Error("The provided key does not have the required permissions."), {
          code: "permission_error",
          type: "invalid_request_error",
        });
      },
    } as unknown as Stripe["refunds"],
  };
  const app = buildApp({ database, logger: false, stripe: failingStripe });
  context.after(async () => app.close());

  const operatorCookie = await login(app, "refund.operator@zerofayyz.test");
  const requested = await app.inject({
    method: "POST",
    url: `/api/v1/admin/payments/${PAYMENT_ID}/refund-requests`,
    headers: { cookie: operatorCookie },
    payload: { reason: "Provider will fail" },
  });
  const requestId = requested.json().id as string;

  const adminCookie = await login(app, "refund.admin@zerofayyz.test");
  const failed = await app.inject({
    method: "POST",
    url: `/api/v1/admin/refund-requests/${requestId}/approve`,
    headers: { cookie: adminCookie },
    payload: {},
  });
  assert.equal(failed.statusCode, 502);
  // The operator must be told what to fix, not merely that something broke.
  assert.match(failed.json().error, /required permissions/);

  // The claim was released: still pending, decidable by someone, and the
  // failed attempt is in the history.
  const stored = await database.query<{ status: string; decided_by: string | null }>(
    "SELECT status, decided_by FROM refund_requests WHERE id = $1",
    [requestId],
  );
  assert.equal(stored.rows[0]?.status, "pending");
  assert.equal(stored.rows[0]?.decided_by, null);

  const audit = await database.query<{ action: string; metadata: { stripeCode?: string } }>(
    "SELECT action, metadata FROM audit_logs WHERE action = 'refund.approve_failed' AND entity_id = $1",
    [requestId],
  );
  assert.equal(audit.rows.length >= 1, true);
  // And the history keeps the provider's code, so the same failure recurring
  // is diagnosable weeks later.
  assert.equal(audit.rows[0]?.metadata?.stripeCode, "permission_error");
});
