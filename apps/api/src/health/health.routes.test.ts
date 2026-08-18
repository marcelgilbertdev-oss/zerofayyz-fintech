import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../app.js";
import type { Database } from "../database/database.js";

function createDatabaseStub(operational: boolean): Database {
  return {
    async checkHealth() {
      return operational
        ? { operational: true, latencyMs: 3, name: "zerofayyz_fintech" }
        : { operational: false, latencyMs: null, name: null };
    },
    async close() {},
  };
}

test("GET /api/v1/health reports the API as operational", async (context) => {
  const app = buildApp({ database: createDatabaseStub(true), logger: false });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/health",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");

  const payload = response.json<{
    service: string;
    status: string;
    environment: string;
    version: string;
    timestamp: string;
    checks: {
      database: {
        status: string;
        latencyMs: number | null;
        name: string | null;
      };
    };
  }>();

  assert.deepEqual(
    {
      service: payload.service,
      status: payload.status,
      environment: payload.environment,
      version: payload.version,
    },
    {
      service: "zerofayyz-fintech-api",
      status: "operational",
      environment: "development",
      version: "0.1.0",
    },
  );
  assert.deepEqual(payload.checks.database, {
    status: "operational",
    latencyMs: 3,
    name: "zerofayyz_fintech",
  });
  assert.equal(Number.isNaN(Date.parse(payload.timestamp)), false);
});

test("GET /api/v1/health reports degraded when PostgreSQL is unavailable", async (context) => {
  const app = buildApp({ database: createDatabaseStub(false), logger: false });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/health",
  });
  const payload = response.json<{
    status: string;
    checks: {
      database: {
        status: string;
        latencyMs: number | null;
        name: string | null;
      };
    };
  }>();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.status, "degraded");
  assert.deepEqual(payload.checks.database, {
    status: "unavailable",
    latencyMs: null,
    name: null,
  });
});

test("unknown API routes return 404", async (context) => {
  const app = buildApp({ database: createDatabaseStub(true), logger: false });
  context.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/missing",
  });

  assert.equal(response.statusCode, 404);
});
