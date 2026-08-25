import { describe, expect, it } from "vitest";

import { healthSchema, metricsSchema, transactionsSchema } from "./schemas";

/**
 * The schemas ARE the client's contract with the API, so they get tested like
 * one: valid payloads pass, and the drift cases we actually fear are rejected
 * with the offending field named.
 */

// Typed against the schema's input so degraded-state fixtures (null latency)
// assign cleanly; structuredClone of an inferred literal narrows too far.
const validHealth: import("zod").input<typeof healthSchema> = {
  service: "zerofayyz-fintech-api",
  status: "operational",
  environment: "production",
  version: "0.1.0",
  timestamp: "2026-08-21T00:00:00.000Z",
  checks: {
    database: { status: "operational", latencyMs: 3, name: "neondb" },
    stripe: { status: "configured" },
    webhook: { status: "configured" },
  },
};

describe("healthSchema", () => {
  it("accepts the live payload shape", () => {
    expect(healthSchema.parse(validHealth).checks.database.latencyMs).toBe(3);
  });

  it("accepts a degraded system with null latency", () => {
    const degraded = structuredClone(validHealth);
    degraded.status = "degraded";
    degraded.checks.database = { status: "unavailable", latencyMs: null, name: null };

    expect(healthSchema.parse(degraded).status).toBe("degraded");
  });

  it("rejects an unknown status value rather than passing it through", () => {
    const drifted = structuredClone(validHealth) as Record<string, unknown>;
    drifted.status = "partial-outage";

    const result = healthSchema.safeParse(drifted);
    expect(result.success).toBe(false);
  });
});

describe("metricsSchema", () => {
  const valid = {
    currency: "JPY",
    grossVolumeMinor: 122_200,
    succeededCount: 3,
    successRate: 75,
    pending: { amountMinor: 22_750, count: 2 },
    eventsRecorded: 5,
    dailyVolume: [{ date: "2026-08-21", amountMinor: 4_200 }],
  };

  it("accepts the live payload shape", () => {
    expect(metricsSchema.parse(valid).grossVolumeMinor).toBe(122_200);
  });

  it("accepts a null success rate — an empty ledger has no rate, not 0%", () => {
    expect(metricsSchema.parse({ ...valid, successRate: null }).successRate).toBeNull();
  });

  it("rejects fractional minor units — money must arrive as integers", () => {
    const result = metricsSchema.safeParse({ ...valid, grossVolumeMinor: 1222.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed date bucket", () => {
    const result = metricsSchema.safeParse({
      ...valid,
      dailyVolume: [{ date: "08/21/2026", amountMinor: 100 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("transactionsSchema", () => {
  const valid = {
    data: [
      {
        id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
        customer: { displayName: "Portfolio Recruiter", email: "p@zerofayyz.test" },
        amountMinor: 4_200,
        currency: "JPY",
        status: "succeeded",
        methodLabel: "Stripe Checkout",
        createdAt: "2026-08-20T19:27:09.259Z",
      },
    ],
    meta: { count: 1, source: "postgresql" },
  };

  it("accepts the live payload shape", () => {
    expect(transactionsSchema.parse(valid).data).toHaveLength(1);
  });

  it("rejects a non-UUID id — the React duplicate-key bug rode on this field", () => {
    const drifted = structuredClone(valid);
    drifted.data[0]!.id = "not-a-uuid";

    expect(transactionsSchema.safeParse(drifted).success).toBe(false);
  });

  it("rejects an unexpected data source", () => {
    const drifted = structuredClone(valid);
    (drifted.meta as Record<string, unknown>).source = "cache";

    expect(transactionsSchema.safeParse(drifted).success).toBe(false);
  });
});
