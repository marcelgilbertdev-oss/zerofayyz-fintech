import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildApp } from "./app.js";
import type { Database } from "./database/database.js";

function databaseStub(): Database {
  return {
    async checkHealth() {
      return { operational: true, latencyMs: 1, name: "test" };
    },
    async query() {
      throw new Error("unexpected query");
    },
    async queryAsUser(): Promise<never> {
      throw new Error("queryAsUser is not stubbed in this test");
    },
    async close() {},
  };
}

/**
 * The security headers are static, so the test can be exact rather than
 * pattern-matched — and exactness is the point: a policy that drifts one
 * directive at a time is how "we send a CSP" quietly stops meaning anything.
 */
describe("security headers", () => {
  const expected: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "cross-origin-resource-policy": "same-origin",
  };

  it("every response carries the full set", async (t) => {
    const app = buildApp({ database: databaseStub(), logger: false });
    t.after(async () => app.close());

    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    for (const [header, value] of Object.entries(expected)) {
      assert.equal(response.headers[header], value, `missing or drifted: ${header}`);
    }
  });

  it("errors and 404s are protected too, not only happy paths", async (t) => {
    // Error responses are still responses; a policy that evaporates on the
    // failure path protects exactly the traffic nobody is watching.
    const app = buildApp({ database: databaseStub(), logger: false });
    t.after(async () => app.close());

    const missing = await app.inject({ method: "GET", url: "/api/v1/does-not-exist" });
    const refused = await app.inject({ method: "GET", url: "/api/v1/admin/audit-logs" });

    for (const response of [missing, refused]) {
      assert.equal(response.headers["x-content-type-options"], "nosniff");
      assert.equal(response.headers["x-frame-options"], "DENY");
    }
    assert.equal(missing.statusCode, 404);
    assert.equal(refused.statusCode, 401);
  });
});
