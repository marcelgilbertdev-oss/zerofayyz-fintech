import assert from "node:assert/strict";
import test from "node:test";

import type {
  QueryConfigValues,
  QueryResult,
  QueryResultRow,
} from "pg";

import { buildApp } from "../app.js";
import type { Database } from "../database/database.js";
import type { StripeGateway } from "./stripe.gateway.js";

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function createPaymentDatabaseStub(): Database {
  return {
    async checkHealth() {
      return { operational: true, latencyMs: 2, name: "zerofayyz_fintech" };
    },
    async query<
      Row extends QueryResultRow,
      Values extends unknown[] = unknown[],
    >(
      text: string,
      _values?: QueryConfigValues<Values>,
    ): Promise<QueryResult<Row>> {
      if (text.includes("INSERT INTO users")) {
        return queryResult([
          { id: "10000000-0000-4000-8000-000000000001" } as unknown as Row,
        ]);
      }

      return queryResult<Row>([]);
    },
    async queryAsUser(): Promise<never> {
      throw new Error("queryAsUser is not stubbed in this test");
    },
    async close() {},
  };
}

test("POST /api/v1/payments/checkout-session creates a hosted sandbox checkout", async (context) => {
  let checkoutParameters: Record<string, unknown> | undefined;
  const stripe = {
    checkout: {
      sessions: {
        async create(parameters: Record<string, unknown>) {
          checkoutParameters = parameters;
          return {
            id: "cs_test_zerofayyz",
            url: "https://checkout.stripe.com/c/pay/cs_test_zerofayyz",
          };
        },
      },
    },
    webhooks: {
      constructEvent() {
        throw new Error("Unexpected webhook call");
      },
    },
  } as unknown as StripeGateway;
  const app = buildApp({
    database: createPaymentDatabaseStub(),
    logger: false,
    stripe,
  });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/payments/checkout-session",
    payload: {},
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), {
    checkoutSessionId: "cs_test_zerofayyz",
    url: "https://checkout.stripe.com/c/pay/cs_test_zerofayyz",
  });
  assert.equal(checkoutParameters?.mode, "payment");
  // Pinned to card after a reviewer hit Amazon Pay's sandbox wall on the
  // hosted page — a dead-end we cannot fix from our side, so we do not offer
  // the door.
  assert.deepEqual(checkoutParameters?.payment_method_types, ["card"]);
  assert.equal("automatic_tax" in (checkoutParameters ?? {}), false);
});

test("POST /api/v1/payments/checkout-session stays disabled without a Stripe key", async (context) => {
  const app = buildApp({
    database: createPaymentDatabaseStub(),
    logger: false,
    stripe: null,
  });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/payments/checkout-session",
    payload: {},
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: "Stripe sandbox is not configured",
  });
});

function createStripeSpy(capture: (parameters: Record<string, unknown>) => void) {
  return {
    checkout: {
      sessions: {
        async create(parameters: Record<string, unknown>) {
          capture(parameters);
          return {
            id: "cs_test_zerofayyz",
            url: "https://checkout.stripe.com/c/pay/cs_test_zerofayyz",
          };
        },
      },
    },
    webhooks: {
      constructEvent() {
        throw new Error("Unexpected webhook call");
      },
    },
  } as unknown as StripeGateway;
}

// The ledger row and the Stripe line item have to agree. If they drift, the
// dashboard shows one number and the customer is charged another — the kind of
// defect that is invisible until an accountant finds it.
test("POST /api/v1/payments/checkout-session honours a caller-supplied amount", async (context) => {
  let checkoutParameters: Record<string, unknown> | undefined;
  let ledgerValues: unknown[] | undefined;
  const database: Database = {
    async checkHealth() {
      return { operational: true, latencyMs: 2, name: "zerofayyz_fintech" };
    },
    async query<Row extends QueryResultRow, Values extends unknown[] = unknown[]>(
      text: string,
      values?: QueryConfigValues<Values>,
    ): Promise<QueryResult<Row>> {
      if (text.includes("INSERT INTO users")) {
        return queryResult([
          { id: "10000000-0000-4000-8000-000000000001" } as unknown as Row,
        ]);
      }

      if (text.includes("INSERT INTO payments")) {
        ledgerValues = values as unknown[];
      }

      return queryResult<Row>([]);
    },
    async queryAsUser(): Promise<never> {
      throw new Error("queryAsUser is not stubbed in this test");
    },
    async close() {},
  };
  const app = buildApp({
    database,
    logger: false,
    stripe: createStripeSpy((parameters) => {
      checkoutParameters = parameters;
    }),
  });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/payments/checkout-session",
    payload: { amountMinor: 17_350 },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(ledgerValues?.[2], 17_350);

  const lineItems = checkoutParameters?.line_items as
    | Array<{ price_data?: { unit_amount?: number } }>
    | undefined;
  assert.equal(lineItems?.[0]?.price_data?.unit_amount, 17_350);
});

test("POST /api/v1/payments/checkout-session falls back to the demo amount", async (context) => {
  let checkoutParameters: Record<string, unknown> | undefined;
  const app = buildApp({
    database: createPaymentDatabaseStub(),
    logger: false,
    stripe: createStripeSpy((parameters) => {
      checkoutParameters = parameters;
    }),
  });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/payments/checkout-session",
    payload: {},
  });

  assert.equal(response.statusCode, 201);

  const lineItems = checkoutParameters?.line_items as
    | Array<{ price_data?: { unit_amount?: number } }>
    | undefined;
  assert.equal(lineItems?.[0]?.price_data?.unit_amount, 4_200);
});

// Bounds are enforced by the route schema, so a bad amount is rejected before
// any row is written and before Stripe is ever called.
for (const [name, amountMinor] of [
  ["below the Stripe minimum", 49],
  ["above the sandbox ceiling", 1_500_001],
  ["negative", -500],
  ["fractional minor units", 42.5],
] as const) {
  test(`POST /api/v1/payments/checkout-session rejects an amount ${name}`, async (context) => {
    let stripeCalled = false;
    let ledgerWritten = false;
    const database: Database = {
      async checkHealth() {
        return { operational: true, latencyMs: 2, name: "zerofayyz_fintech" };
      },
      async query<Row extends QueryResultRow>(
        text: string,
      ): Promise<QueryResult<Row>> {
        if (text.includes("INSERT INTO payments")) {
          ledgerWritten = true;
        }

        if (text.includes("INSERT INTO users")) {
          return queryResult([
            { id: "10000000-0000-4000-8000-000000000001" } as unknown as Row,
          ]);
        }

        return queryResult<Row>([]);
      },
      async queryAsUser(): Promise<never> {
        throw new Error("queryAsUser is not stubbed in this test");
      },
      async close() {},
    };
    const app = buildApp({
      database,
      logger: false,
      stripe: createStripeSpy(() => {
        stripeCalled = true;
      }),
    });
    context.after(async () => app.close());

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/payments/checkout-session",
      payload: { amountMinor },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(stripeCalled, false, "Stripe must not be called for a rejected amount");
    assert.equal(ledgerWritten, false, "no ledger row may be written for a rejected amount");
  });
}
