import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import Page from "../routes/+page.svelte";
import HealthPanel from "./HealthPanel.svelte";
import MetricTiles from "./MetricTiles.svelte";
import TransactionsTable from "./TransactionsTable.svelte";

/** Queried by role and visible text — the way a user or screen reader reaches them. */

describe("MetricTiles", () => {
  const metrics = {
    currency: "JPY",
    grossVolumeMinor: 122_200,
    succeededCount: 3,
    successRate: 75,
    pending: { amountMinor: 22_750, count: 2 },
    eventsRecorded: 5,
    dailyVolume: [],
  };

  it("renders whole-yen amounts — ¥122,200, never a /100 relic like ¥1,222", () => {
    render(MetricTiles, { props: { metrics } });

    expect(screen.getByText("¥122,200")).toBeTruthy();
    expect(screen.getByText("¥22,750")).toBeTruthy();
  });

  it("says there is no success rate rather than showing 0%", () => {
    render(MetricTiles, { props: { metrics: { ...metrics, successRate: null } } });

    expect(screen.getByText("No settled payments yet")).toBeTruthy();
    expect(screen.queryByText(/0% success rate/)).toBeNull();
  });
});

describe("HealthPanel", () => {
  it("reports the live count and labels the down integration", () => {
    render(HealthPanel, {
      props: {
        health: {
          service: "zerofayyz-fintech-api",
          status: "operational" as const,
          environment: "production",
          version: "0.1.0",
          timestamp: "2026-08-21T00:00:00.000Z",
          checks: {
            database: { status: "operational" as const, latencyMs: 3, name: "neondb" },
            stripe: { status: "configured" as const },
            webhook: { status: "unconfigured" as const },
          },
        },
      },
    });

    expect(screen.getByText("3 of 4 live")).toBeTruthy();
    expect(screen.getByText("Awaiting signing secret")).toBeTruthy();
  });
});

describe("TransactionsTable", () => {
  it("renders rows from validated data", () => {
    render(TransactionsTable, {
      props: {
        transactions: {
          data: [
            {
              id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
              customer: { displayName: "Portfolio Recruiter", email: "p@zerofayyz.test" },
              amountMinor: 4_200,
              currency: "JPY",
              status: "succeeded",
              methodLabel: "Stripe Checkout",
              createdAt: new Date().toISOString(),
            },
          ],
          meta: { count: 1, source: "postgresql" as const },
        },
      },
    });

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Portfolio Recruiter")).toBeTruthy();
    expect(screen.getByText("¥4,200")).toBeTruthy();
  });

  it("shows an empty state instead of a bare table", () => {
    render(TransactionsTable, {
      props: {
        transactions: { data: [], meta: { count: 0, source: "postgresql" as const } },
      },
    });

    expect(screen.getByText("No transactions yet.")).toBeTruthy();
  });
});

/**
 * Same two guarantees as the Vue client, asserted the same way — the two suites are
 * meant to agree assertion-for-assertion (ADR 0010). Rendered output, not deployment:
 * SvelteKit lazy-loads the chunk this markup lives in, so no fetch of the served HTML
 * can see it.
 */
describe("Page shell", () => {
  it("carries a header door to the operator area, and the area it points at", () => {
    render(Page);

    const door = screen.getByRole("link", { name: /operator sign-in/i });
    expect(door.getAttribute("href")).toBe("#operator");
    expect(document.querySelector("#operator")).not.toBeNull();
  });

  it("links to the other two clients, so one API serving three is verifiable", () => {
    render(Page);

    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("zerofayyz-fintech.vercel.app"))).toBe(true);
    expect(hrefs.some((h) => h.includes("fintech-vue.vercel.app"))).toBe(true);
  });

  it("labels the amount field in yen — the currency it actually renders", () => {
    render(Page);

    expect(screen.getByLabelText(/japanese yen/i)).toBeTruthy();
  });
});

/**
 * The API reported clientOrigins and errorTracking for weeks while every client
 * dropped them — the contract did not name errorTracking, and a Zod object
 * strips what it does not name — so the badge read "4 of 4 live" over a subset
 * and called it a total. Both fields are optional, because the clients deploy
 * separately from the API, so the panel must render what it is given and count
 * only that.
 */
describe("HealthPanel integration coverage", () => {
  // Auto-cleanup only registers under test-runner globals, which are off here,
  // so the previous render's DOM would otherwise still be mounted and the
  // "omits it" assertion would find the row the test before it created.
  afterEach(cleanup);

  const base = {
    service: "zerofayyz-fintech-api",
    status: "operational" as const,
    environment: "production",
    version: "0.1.0",
    timestamp: "2026-08-29T00:00:00.000Z",
    checks: {
      database: { status: "operational" as const, latencyMs: 3, name: "neondb" },
      stripe: { status: "configured" as const },
      webhook: { status: "configured" as const },
    },
  };

  it("shows every integration the API reports, and counts what it shows", () => {
    render(HealthPanel, {
      health: {
          ...base,
          checks: {
            ...base.checks,
            clientOrigins: { status: "configured" as const, count: 2 },
            errorTracking: { status: "configured" as const },
        },
      },
    });

    expect(screen.getByText("Return allowlist")).toBeTruthy();
    expect(screen.getByText("2 approved origins")).toBeTruthy();
    expect(screen.getByText("Error tracking")).toBeTruthy();
    expect(screen.getByText("6 of 6 live")).toBeTruthy();
  });

  it("omits what an older API never reported rather than calling it down", () => {
    render(HealthPanel, { health: base });

    expect(screen.queryByText("Return allowlist")).toBeNull();
    expect(screen.queryByText("Error tracking")).toBeNull();
    expect(screen.getByText("4 of 4 live")).toBeTruthy();
  });
});
