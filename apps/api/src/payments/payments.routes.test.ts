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
  assert.equal("payment_method_types" in (checkoutParameters ?? {}), false);
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
