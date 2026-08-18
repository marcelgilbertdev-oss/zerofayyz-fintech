import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../app.js";

test("GET /api/v1/health reports the API as operational", async (context) => {
  const app = buildApp();
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
  assert.equal(Number.isNaN(Date.parse(payload.timestamp)), false);
});

test("unknown API routes return 404", async (context) => {
  const app = buildApp();
  context.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/missing",
  });

  assert.equal(response.statusCode, 404);
});
