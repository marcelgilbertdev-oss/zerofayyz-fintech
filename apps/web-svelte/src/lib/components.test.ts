import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

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
        liveChecks: 3,
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
