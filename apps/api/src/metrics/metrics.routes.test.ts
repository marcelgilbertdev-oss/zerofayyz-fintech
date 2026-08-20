import assert from "node:assert/strict";
import test from "node:test";

import type {
  QueryConfigValues,
  QueryResult,
  QueryResultRow,
} from "pg";

import { buildApp } from "../app.js";
import type { Database } from "../database/database.js";

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

type SummaryShape = {
  gross_minor: string;
  succeeded_count: string;
  settled_count: string;
  pending_minor: string;
  pending_count: string;
  event_count: string;
};

function createMetricsDatabaseStub(summary: SummaryShape): Database {
  return {
    async checkHealth() {
      return { operational: true, latencyMs: 1, name: "zerofayyz_fintech" };
    },
    async query<
      Row extends QueryResultRow,
      Values extends unknown[] = unknown[],
    >(
      text: string,
      _values?: QueryConfigValues<Values>,
    ): Promise<QueryResult<Row>> {
      if (text.includes("GENERATE_SERIES")) {
        return queryResult([
          { day: new Date("2026-08-19T00:00:00.000Z"), volume_minor: "4200" },
          { day: new Date("2026-08-20T00:00:00.000Z"), volume_minor: "0" },
        ] as unknown as Row[]);
      }

      return queryResult([summary] as unknown as Row[]);
    },
    async close() {},
  };
}

test("GET /api/v1/metrics derives every figure from PostgreSQL", async (context) => {
  const app = buildApp({
    database: createMetricsDatabaseStub({
      gross_minor: "118000",
      succeeded_count: "2",
      settled_count: "3",
      pending_minor: "18550",
      pending_count: "1",
      event_count: "7",
    }),
    logger: false,
    stripe: null,
  });
  context.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/metrics" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    currency: "USD",
    grossVolumeMinor: 118_000,
    succeededCount: 2,
    successRate: 66.7,
    pending: { amountMinor: 18_550, count: 1 },
    eventsRecorded: 7,
    dailyVolume: [
      { date: "2026-08-19", amountMinor: 4_200 },
      { date: "2026-08-20", amountMinor: 0 },
    ],
  });
});

test("GET /api/v1/metrics reports no success rate before anything settles", async (context) => {
  const app = buildApp({
    database: createMetricsDatabaseStub({
      gross_minor: "0",
      succeeded_count: "0",
      settled_count: "0",
      pending_minor: "0",
      pending_count: "0",
      event_count: "0",
    }),
    logger: false,
    stripe: null,
  });
  context.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/metrics" });

  assert.equal(response.statusCode, 200);
  // An empty ledger has no success rate; reporting 0% would be a lie.
  assert.equal(response.json().successRate, null);
  assert.equal(response.json().grossVolumeMinor, 0);
});
