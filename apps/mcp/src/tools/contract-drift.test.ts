import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiClient } from "../api-client.js";
import { loadConfig } from "../config.js";
import {
  CONTRACT_CHECKS,
  checkContractDrift,
  formatIssues,
} from "./contract-drift.js";
import { healthSchema } from "../schemas.js";

const config = loadConfig({ MCP_API_URL: "https://api.test" });

/** A health payload that satisfies the shared contract. */
function validHealth() {
  return {
    service: "zerofayyz-fintech-api",
    status: "operational",
    environment: "test",
    version: "1.0.0",
    timestamp: new Date(0).toISOString(),
    checks: {
      database: { status: "operational", latencyMs: 4, name: "neondb" },
      stripe: { status: "configured" },
      webhook: { status: "configured" },
    },
  };
}

function stubFetch(handler: (url: string) => { status?: number; body: unknown }) {
  return async (url: string): Promise<Response> => {
    const { status = 200, body } = handler(url);

    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("checkContractDrift", () => {
  it("reports no drift when the API matches the contract", async () => {
    const client = new ApiClient(
      config,
      stubFetch(() => ({ body: validHealth() })),
    );

    const report = await checkContractDrift(client, [
      { endpoint: "/api/v1/health", schema: healthSchema, authenticated: false },
    ]);

    assert.equal(report.drifted, 0);
    assert.equal(report.checked, 1);
    assert.equal(report.findings[0]?.valid, true);
    assert.match(report.summary, /match the shared contract/);
  });

  it("names the drifted field rather than just failing", async () => {
    const drifted = validHealth();
    // The exact shape of a real drift: a number becomes a string upstream.
    (drifted.checks.database as Record<string, unknown>).latencyMs = "4";

    const client = new ApiClient(
      config,
      stubFetch(() => ({ body: drifted })),
    );

    const report = await checkContractDrift(client, [
      { endpoint: "/api/v1/health", schema: healthSchema, authenticated: false },
    ]);

    assert.equal(report.drifted, 1);
    const problems = report.findings[0]?.problems ?? [];
    assert.ok(
      problems.some((problem) => problem.includes("checks.database.latencyMs")),
      `expected the drifted field to be named, got: ${JSON.stringify(problems)}`,
    );
  });

  it("treats a non-2xx response as drift instead of parsing it", async () => {
    const client = new ApiClient(
      config,
      stubFetch(() => ({ status: 503, body: { error: "unavailable" } })),
    );

    const report = await checkContractDrift(client, [
      { endpoint: "/api/v1/health", schema: healthSchema, authenticated: false },
    ]);

    assert.equal(report.drifted, 1);
    assert.match(report.findings[0]?.problems[0] ?? "", /got 503/);
  });

  it("records a transport failure as drift without throwing", async () => {
    const client = new ApiClient(config, async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const report = await checkContractDrift(client, [
      { endpoint: "/api/v1/health", schema: healthSchema, authenticated: false },
    ]);

    assert.equal(report.apiReachable, false);
    assert.equal(report.drifted, 1);
    assert.match(report.findings[0]?.problems[0] ?? "", /request failed/);
  });

  it("counts a missing credential as skipped, not as drift", async () => {
    // Found by running this tool against production: an unconfigured operator
    // credential was reported as a drifted endpoint, which is the cry-wolf
    // failure the whole tool exists to avoid.
    const client = new ApiClient(config, async () => {
      throw new Error(
        "No operator credentials configured. Set MCP_OPERATOR_EMAIL and " +
          "MCP_OPERATOR_PASSWORD to use tools that read privileged endpoints.",
      );
    });

    const report = await checkContractDrift(client, [
      { endpoint: "/api/v1/admin/audit-logs", schema: healthSchema, authenticated: true },
    ]);

    assert.equal(report.skipped, 1);
    assert.equal(report.drifted, 0, "a missing credential must not read as drift");
    assert.equal(report.findings[0]?.skipped, true);
    assert.match(report.summary, /skipped \(not configured\)/);
  });

  it("still counts a genuine transport failure as drift", async () => {
    const client = new ApiClient(config, async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const report = await checkContractDrift(client, [
      { endpoint: "/api/v1/health", schema: healthSchema, authenticated: false },
    ]);

    assert.equal(report.skipped, 0);
    assert.equal(report.drifted, 1);
  });

  it("checks every endpoint the contract makes a promise about", () => {
    // Guards against adding a schema to the shared contract and forgetting to
    // verify it here — an unverified promise is worse than no promise.
    const endpoints = CONTRACT_CHECKS.map((check) => check.endpoint);

    assert.ok(endpoints.includes("/api/v1/health"));
    assert.ok(endpoints.includes("/api/v1/metrics"));
    assert.ok(endpoints.includes("/api/v1/transactions"));
    assert.equal(new Set(endpoints).size, endpoints.length, "duplicate endpoint");
  });
});

describe("formatIssues", () => {
  it("labels a root-level failure legibly", () => {
    const parsed = healthSchema.safeParse("not an object");
    assert.equal(parsed.success, false);

    if (!parsed.success) {
      assert.deepEqual(formatIssues(parsed.error).length > 0, true);
      assert.match(formatIssues(parsed.error)[0] ?? "", /response root/);
    }
  });
});
