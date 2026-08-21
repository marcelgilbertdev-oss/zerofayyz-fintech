import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDashboardStore } from "./dashboard";

/**
 * The store is tested through its public surface with fetch mocked at the
 * network boundary — the same seam the real app crosses — rather than by
 * mocking the api module, so the Zod validation runs in every test.
 */

const health = {
  service: "zerofayyz-fintech-api",
  status: "operational",
  environment: "test",
  version: "0.1.0",
  timestamp: "2026-08-21T00:00:00.000Z",
  checks: {
    database: { status: "operational", latencyMs: 2, name: "neondb" },
    stripe: { status: "configured" },
    webhook: { status: "configured" },
  },
};

const metrics = {
  currency: "USD",
  grossVolumeMinor: 122_200,
  succeededCount: 3,
  successRate: 75,
  pending: { amountMinor: 22_750, count: 2 },
  eventsRecorded: 5,
  dailyVolume: [],
};

const transactions = {
  data: [],
  meta: { count: 0, source: "postgresql" },
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dashboard store", () => {
  it("loads all three panels and reports 4 of 4 live", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/health")) return respond(health);
      if (path.includes("/metrics")) return respond(metrics);
      return respond(transactions);
    }));

    const store = useDashboardStore();
    await store.load();

    expect(store.state).toBe("ready");
    expect(store.errors).toEqual([]);
    expect(store.liveChecks).toBe(4);
    expect(store.grossVolume).toBe(1222);
  });

  it("keeps working panels when one endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/metrics")) return respond({ error: "boom" }, 500);
      if (path.includes("/health")) return respond(health);
      return respond(transactions);
    }));

    const store = useDashboardStore();
    await store.load();

    // Partial failure degrades one panel, not the page.
    expect(store.state).toBe("ready");
    expect(store.metrics).toBeNull();
    expect(store.health).not.toBeNull();
    expect(store.errors).toHaveLength(1);
    expect(store.errors[0]).toContain("/api/v1/metrics");
  });

  it("treats a drifted payload as an error, not as data", async () => {
    const driftedHealth = { ...health, status: "partial-outage" };

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/health")) return respond(driftedHealth);
      if (path.includes("/metrics")) return respond(metrics);
      return respond(transactions);
    }));

    const store = useDashboardStore();
    await store.load();

    // Validation failure at the boundary must not silently become null-y UI.
    expect(store.health).toBeNull();
    expect(store.errors.some((message) => message.includes("unexpected shape"))).toBe(true);
  });

  it("goes to error only when nothing loads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: "down" }, 503)));

    const store = useDashboardStore();
    await store.load();

    expect(store.state).toBe("error");
    expect(store.errors).toHaveLength(3);
  });

  it("recovers when a retry succeeds after total failure", async () => {
    // First load: everything down (the cold-start case). Retry: all healthy.
    // The error state must not be a dead end — this is the Try-again path.
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls += 1;
      if (calls <= 3) return respond({ error: "asleep" }, 503);
      const path = String(input);
      if (path.includes("/health")) return respond(health);
      if (path.includes("/metrics")) return respond(metrics);
      return respond(transactions);
    }));

    const store = useDashboardStore();
    await store.load();
    expect(store.state).toBe("error");

    await store.load();
    expect(store.state).toBe("ready");
    expect(store.errors).toEqual([]);
    expect(store.liveChecks).toBe(4);
  });

  it("surfaces the API's own message when checkout fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      respond({ error: "Stripe sandbox is not configured" }, 503),
    ));

    const store = useDashboardStore();
    await store.checkout();

    expect(store.checkoutError).toBe("Stripe sandbox is not configured");
    expect(store.checkoutPending).toBe(false);
  });
});
