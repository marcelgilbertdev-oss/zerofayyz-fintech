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
    async query() {
      throw new Error("Unexpected database query in health test");
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

test("GET /api/v1/ready admits traffic when the database answers", async (context) => {
  const app = buildApp({ database: createDatabaseStub(true), logger: false });
  context.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/ready" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ready: true });
});

test("GET /api/v1/ready refuses traffic when the database is down — where /health stays 200", async (context) => {
  // The whole reason /ready exists: liveness and readiness are different
  // questions. A process that can describe its own degradation is alive (200
  // on /health); an instance that cannot reach the ledger must not be routed
  // payments (503 here). One endpoint answering both is how a deploy passes
  // its check and then serves 500s.
  const app = buildApp({ database: createDatabaseStub(false), logger: false });
  context.after(async () => app.close());

  const ready = await app.inject({ method: "GET", url: "/api/v1/ready" });
  const health = await app.inject({ method: "GET", url: "/api/v1/health" });

  assert.equal(ready.statusCode, 503);
  assert.deepEqual(ready.json(), { ready: false, reason: "database unreachable" });
  assert.equal(health.statusCode, 200);
});
