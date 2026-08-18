import assert from "node:assert/strict";
import test from "node:test";

import type {
  QueryConfigValues,
  QueryResult,
  QueryResultRow,
} from "pg";

import { buildApp } from "../app.js";
import type { Database } from "../database/database.js";

function createTransactionDatabaseStub(): Database {
  return {
    async checkHealth() {
      return { operational: true, latencyMs: 2, name: "zerofayyz_fintech" };
    },
    async query<
      Row extends QueryResultRow,
      Values extends unknown[] = unknown[],
    >(
      _text: string,
      _values?: QueryConfigValues<Values>,
    ): Promise<QueryResult<Row>> {
      return {
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [
          {
            id: "20000000-0000-4000-8000-000000000001",
            display_name: "Nadia Al-Sabah",
            email: "nadia@example.test",
            amount_minor: "42000",
            currency: "USD",
            status: "succeeded",
            created_at: new Date("2026-08-18T12:00:00.000Z"),
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
        customer: {
          displayName: "Nadia Al-Sabah",
          email: "nadia@example.test",
        },
        amountMinor: 42000,
        currency: "USD",
        status: "succeeded",
        methodLabel: "Sandbox card",
        createdAt: "2026-08-18T12:00:00.000Z",
      },
    ],
    meta: {
      count: 1,
      source: "postgresql",
    },
  });
});
