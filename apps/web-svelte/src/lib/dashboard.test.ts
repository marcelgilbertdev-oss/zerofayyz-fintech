import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDashboard } from "./dashboard.svelte";

/**
 * The same behavioural contract as the Vue client's store tests, deliberately.
 * Two frameworks, one specification: if these two suites ever disagree, one of
 * the clients has drifted from the other.
 *
 * fetch is mocked at the network seam rather than the api module, so Zod
 * validation runs inside every test.
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
  currency: "JPY",
  grossVolumeMinor: 122_200,
  succeededCount: 3,
  successRate: 75,
  pending: { amountMinor: 22_750, count: 2 },
  eventsRecorded: 5,
  dailyVolume: [],
};

const transactions = { data: [], meta: { count: 0, source: "postgresql" } };

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("location", { assign: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("svelte dashboard state", () => {
  it("loads all three panels and reports 4 of 4 live", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/health")) return respond(health);
      if (path.includes("/metrics")) return respond(metrics);
      return respond(transactions);
    }));

    const dashboard = createDashboard();
    await dashboard.load();

    expect(dashboard.state).toBe("ready");
    expect(dashboard.errors).toEqual([]);
    expect(dashboard.metrics?.grossVolumeMinor).toBe(122_200);
  });

  it("keeps working panels when one endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/metrics")) return respond({ error: "boom" }, 500);
      if (path.includes("/health")) return respond(health);
      return respond(transactions);
    }));

    const dashboard = createDashboard();
    await dashboard.load();

    expect(dashboard.state).toBe("ready");
    expect(dashboard.metrics).toBeNull();
    expect(dashboard.health).not.toBeNull();
    expect(dashboard.errors).toHaveLength(1);
    expect(dashboard.errors[0]).toContain("/api/v1/metrics");
  });

  it("treats a drifted payload as an error, not as data", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/health")) return respond({ ...health, status: "partial-outage" });
      if (path.includes("/metrics")) return respond(metrics);
      return respond(transactions);
    }));

    const dashboard = createDashboard();
    await dashboard.load();

    expect(dashboard.health).toBeNull();
    expect(dashboard.errors.some((m) => m.includes("unexpected shape"))).toBe(true);
  });

  it("goes to error only when nothing loads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: "down" }, 503)));

    const dashboard = createDashboard();
    await dashboard.load();

    expect(dashboard.state).toBe("error");
    expect(dashboard.errors).toHaveLength(3);
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

    const dashboard = createDashboard();
    await dashboard.load();
    expect(dashboard.state).toBe("error");

    await dashboard.load();
    expect(dashboard.state).toBe("ready");
    expect(dashboard.errors).toEqual([]);
  });

  it("surfaces the API's own message when checkout fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      respond({ error: "Stripe sandbox is not configured" }, 503),
    ));

    const dashboard = createDashboard();
    await dashboard.checkout();

    expect(dashboard.checkoutError).toBe("Stripe sandbox is not configured");
    expect(dashboard.checkoutPending).toBe(false);
  });
});

describe("checkout amount", () => {
  it("refuses an out-of-range amount without touching the network", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => respond({}));
    vi.stubGlobal("fetch", fetchMock);

    const dashboard = createDashboard();
    await dashboard.checkout("99999999");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dashboard.checkoutError).toMatch(/between/i);
    expect(dashboard.checkoutPending).toBe(false);
  });

  it("sends the chosen amount to the API in minor units", async () => {
    // Typed parameters rather than a bare vi.fn(): the build's typecheck is
    // stricter than the test runner, and an untyped mock records its calls as
    // an empty tuple that no cast can rescue.
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        respond({
          checkoutSessionId: "cs_test",
          url: "https://checkout.stripe.com/c/pay/cs_test",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const dashboard = createDashboard();
    await dashboard.checkout("17,350");

    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ amountMinor: 17_350 });
  });
});
