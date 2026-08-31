import assert from "node:assert/strict";
import test from "node:test";

import type {
  QueryConfigValues,
  QueryResult,
  QueryResultRow,
} from "pg";
import type Stripe from "stripe";

import { buildApp } from "../app.js";
import type { Database } from "../database/database.js";
import type { StripeGateway } from "./stripe.gateway.js";

const WEBHOOK_SECRET = "whsec_test_zerofayyz";
const PAYMENT_ID = "20000000-0000-4000-8000-000000000001";

type LedgerWrite = {
  text: string;
  values: unknown[];
};

/**
 * Records every write the handler attempts, so a test can assert not only what
 * was written but that nothing was written at all.
 */
function createRecordingDatabase(
  writes: LedgerWrite[],
  options: { rowCount?: number; failWith?: { code: string } } = {},
): Database {
  return {
    async checkHealth() {
      return { operational: true, latencyMs: 1, name: "zerofayyz_fintech" };
    },
    async query<
      Row extends QueryResultRow,
      Values extends unknown[] = unknown[],
    >(
      text: string,
      values?: QueryConfigValues<Values>,
    ): Promise<QueryResult<Row>> {
      writes.push({ text, values: (values ?? []) as unknown[] });

      if (options.failWith && text.includes("INSERT INTO transactions")) {
        throw Object.assign(new Error("simulated database error"), options.failWith);
      }

      return {
        command: "INSERT",
        rowCount: options.rowCount ?? 1,
        oid: 0,
        fields: [],
        rows: [],
      };
    },
    async queryAsUser(): Promise<never> {
      throw new Error("queryAsUser is not stubbed in this test");
    },
    async close() {},
  };
}

function createStripeStub(event: Stripe.Event | Error): StripeGateway {
  return {
    checkout: {
      sessions: {
        create() {
          throw new Error("Unexpected checkout call");
        },
      },
    },
    webhooks: {
      constructEvent() {
        if (event instanceof Error) {
          throw event;
        }

        return event;
      },
    },
  } as unknown as StripeGateway;
}

function checkoutEvent(
  type: string,
  session: Record<string, unknown>,
  eventId = "evt_test_zerofayyz",
): Stripe.Event {
  return {
    id: eventId,
    object: "event",
    api_version: "2026-08-01",
    created: 1_780_000_000,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    data: {
      object: {
        id: "cs_test_zerofayyz",
        object: "checkout.session",
        client_reference_id: PAYMENT_ID,
        amount_total: 4_200,
        currency: "usd",
        payment_intent: "pi_test_zerofayyz",
        payment_status: "unpaid",
        ...session,
      },
    },
  } as unknown as Stripe.Event;
}

async function postWebhook(
  event: Stripe.Event | Error,
  writes: LedgerWrite[],
  options: {
    secret?: string | undefined;
    signature?: string | undefined;
    rowCount?: number;
    failWith?: { code: string };
  } = {},
) {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const secret = "secret" in options ? options.secret : WEBHOOK_SECRET;

  // Assigning undefined to process.env stores the string "undefined", which
  // would read as a configured secret. Unset it properly instead.
  if (secret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
  }

  const app = buildApp({
    database: createRecordingDatabase(writes, {
      ...(options.rowCount === undefined ? {} : { rowCount: options.rowCount }),
      ...(options.failWith === undefined ? {} : { failWith: options.failWith }),
    }),
    logger: false,
    stripe: createStripeStub(event),
  });

  try {
    return await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        ...(options.signature === undefined
          ? { "stripe-signature": "t=1,v1=deadbeef" }
          : {}),
      },
      payload: JSON.stringify({ id: "evt_test_zerofayyz" }),
    });
  } finally {
    await app.close();

    if (previousSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    }
  }
}

/** The handler passes status as $9 and the transaction event type as $3. */
function ledgerStatus(writes: LedgerWrite[]): { status: unknown; eventType: unknown } {
  const ledgerWrite = writes.find((write) => write.text.includes("INSERT INTO transactions"));

  return {
    status: ledgerWrite?.values[8],
    eventType: ledgerWrite?.values[2],
  };
}

test("a paid checkout.session.completed marks the payment succeeded", async () => {
  const writes: LedgerWrite[] = [];
  const response = await postWebhook(
    checkoutEvent("checkout.session.completed", { payment_status: "paid" }),
    writes,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { received: true, processed: true });
  assert.deepEqual(ledgerStatus(writes), {
    status: "succeeded",
    eventType: "payment_succeeded",
  });
});

test("an unpaid checkout.session.completed stays in processing", async () => {
  const writes: LedgerWrite[] = [];
  const response = await postWebhook(
    checkoutEvent("checkout.session.completed", { payment_status: "unpaid" }),
    writes,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(ledgerStatus(writes), {
    status: "processing",
    eventType: "payment_processing",
  });
});

test("checkout.session.async_payment_succeeded marks the payment succeeded", async () => {
  const writes: LedgerWrite[] = [];
  await postWebhook(
    checkoutEvent("checkout.session.async_payment_succeeded", {}),
    writes,
  );

  assert.deepEqual(ledgerStatus(writes), {
    status: "succeeded",
    eventType: "payment_succeeded",
  });
});

test("checkout.session.async_payment_failed marks the payment failed", async () => {
  const writes: LedgerWrite[] = [];
  await postWebhook(
    checkoutEvent("checkout.session.async_payment_failed", {}),
    writes,
  );

  assert.deepEqual(ledgerStatus(writes), {
    status: "failed",
    eventType: "payment_failed",
  });
});

test("checkout.session.expired marks the payment canceled", async () => {
  const writes: LedgerWrite[] = [];
  await postWebhook(checkoutEvent("checkout.session.expired", {}), writes);

  assert.deepEqual(ledgerStatus(writes), {
    status: "canceled",
    eventType: "payment_canceled",
  });
});

test("the event id is written as the idempotency key", async () => {
  const writes: LedgerWrite[] = [];
  await postWebhook(
    checkoutEvent("checkout.session.completed", { payment_status: "paid" }, "evt_unique_1"),
    writes,
  );

  const ledgerWrite = writes.find((write) => write.text.includes("INSERT INTO transactions"));

  assert.ok(ledgerWrite, "expected a ledger write");
  assert.equal(ledgerWrite.values[1], "evt_unique_1");
  // Redelivery safety lives in the SQL, not in application branching.
  assert.match(ledgerWrite.text, /ON CONFLICT \(provider_event_id\) DO NOTHING/);
});

test("an invalid signature is rejected and writes nothing", async () => {
  const writes: LedgerWrite[] = [];
  const response = await postWebhook(
    new Error("No signatures found matching the expected signature for payload"),
    writes,
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "Invalid Stripe webhook signature" });
  assert.deepEqual(writes, [], "a forged event must not touch the ledger");
});

test("a missing signature header is rejected and writes nothing", async () => {
  const writes: LedgerWrite[] = [];
  const response = await postWebhook(
    checkoutEvent("checkout.session.completed", { payment_status: "paid" }),
    writes,
    { signature: "" },
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(writes, []);
});

test("an event whose client_reference_id is not a UUID writes nothing", async () => {
  const writes: LedgerWrite[] = [];
  const response = await postWebhook(
    checkoutEvent("checkout.session.completed", {
      payment_status: "paid",
      client_reference_id: "not-a-uuid",
      metadata: {},
    }),
    writes,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { received: true, processed: false });
  assert.deepEqual(writes, [], "an unrecognised reference must not reach the database");
});

test("an unhandled event type is acknowledged without processing", async () => {
  const writes: LedgerWrite[] = [];
  const response = await postWebhook(
    checkoutEvent("payment_intent.succeeded", { payment_status: "paid" }),
    writes,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { received: true, processed: false });
  assert.deepEqual(writes, []);
});

test("the webhook stays disabled when no signing secret is configured", async () => {
  const writes: LedgerWrite[] = [];
  const response = await postWebhook(
    checkoutEvent("checkout.session.completed", { payment_status: "paid" }),
    writes,
    { secret: undefined },
  );

  assert.equal(response.statusCode, 503);
  assert.deepEqual(writes, []);
});

test("a redelivered event is acknowledged but not claimed as processed", async () => {
  const writes: LedgerWrite[] = [];
  // ON CONFLICT DO NOTHING means the chained audit insert writes no rows.
  const response = await postWebhook(
    checkoutEvent("checkout.session.completed", { payment_status: "paid" }),
    writes,
    { rowCount: 0 },
  );

  assert.equal(response.statusCode, 200);
  // Stripe needs the 2xx to stop retrying, but nothing was recorded, and
  // saying otherwise would make the response untrue.
  assert.deepEqual(response.json(), { received: true, processed: false });
});

test("an event naming an unknown payment is acknowledged, not retried forever", async () => {
  const writes: LedgerWrite[] = [];
  const response = await postWebhook(
    checkoutEvent("checkout.session.completed", { payment_status: "paid" }),
    writes,
    { failWith: { code: "23503" } },
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { received: true, processed: false });
});

test("an unexpected database error is not swallowed", async () => {
  const writes: LedgerWrite[] = [];
  const response = await postWebhook(
    checkoutEvent("checkout.session.completed", { payment_status: "paid" }),
    writes,
    { failWith: { code: "08006" } },
  );

  // A dropped connection must fail loudly so Stripe retries the delivery.
  assert.equal(response.statusCode, 500);
});
