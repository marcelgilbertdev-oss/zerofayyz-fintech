import assert from "node:assert/strict";
import test from "node:test";

import type {
  QueryConfigValues,
  QueryResult,
  QueryResultRow,
} from "pg";

import { buildApp } from "../app.js";
import type { Database } from "../database/database.js";

function createTransactionDatabaseStub(): Database & {
  queryValues: unknown[][];
} {
  const queryValues: unknown[][] = [];

  return {
    queryValues,
    async checkHealth() {
      return { operational: true, latencyMs: 2, name: "zerofayyz_fintech" };
    },
    async query<
      Row extends QueryResultRow,
      Values extends unknown[] = unknown[],
    >(
      _text: string,
      values?: QueryConfigValues<Values>,
    ): Promise<QueryResult<Row>> {
      queryValues.push((values ?? []) as unknown[]);
      return {
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [
          {
            id: "20000000-0000-4000-8000-000000000001",
            payment_id: "10000000-0000-4000-8000-000000000001",
            display_name: "Nadia Al-Sabah",
            email: "nadia@example.test",
            amount_minor: "42000",
            currency: "JPY",
            status: "succeeded",
            method_label: "Sandbox card",
            created_at: new Date("2026-08-18T12:00:00.000Z"),
            total: "1",
          } as unknown as Row,
        ],
      };
    },
    async close() {},
  };
}

test("GET /api/v1/transactions maps PostgreSQL rows to the public response", async (context) => {
  const app = buildApp({
    database: createTransactionDatabaseStub(),
    logger: false,
  });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/transactions",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    data: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        paymentId: "10000000-0000-4000-8000-000000000001",
        customer: {
          displayName: "Nadia Al-Sabah",
          email: "nadia@example.test",
        },
        amountMinor: 42000,
        currency: "JPY",
        status: "succeeded",
        methodLabel: "Sandbox card",
        createdAt: "2026-08-18T12:00:00.000Z",
      },
    ],
    meta: {
      count: 1,
      total: 1,
      limit: 10,
      offset: 0,
      source: "postgresql",
    },
  });
});

test("GET /api/v1/transactions passes limit and offset through to the query", async (context) => {
  // The endpoint shipped with LIMIT 10 hardcoded, silently discarding its
  // query string — found by the MCP QA server's first founder test. These
  // assertions pin the fix: the values reach the SQL as parameters.
  const database = createTransactionDatabaseStub();
  const app = buildApp({ database, logger: false });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/transactions?limit=5&offset=2",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(database.queryValues, [[5, 2]]);

  const meta = response.json().meta;
  assert.equal(meta.limit, 5);
  assert.equal(meta.offset, 2);
});

test("GET /api/v1/transactions defaults to the historical window of 10", async (context) => {
  const database = createTransactionDatabaseStub();
  const app = buildApp({ database, logger: false });
  context.after(async () => app.close());

  await app.inject({ method: "GET", url: "/api/v1/transactions" });

  assert.deepEqual(database.queryValues, [[10, 0]]);
});

test("GET /api/v1/transactions rejects a limit beyond the cap", async (context) => {
  const database = createTransactionDatabaseStub();
  const app = buildApp({ database, logger: false });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/transactions?limit=101",
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(database.queryValues, []);
});
