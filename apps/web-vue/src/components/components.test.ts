import { render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";

import HealthPanel from "./HealthPanel.vue";
import MetricTiles from "./MetricTiles.vue";
import TransactionsTable from "./TransactionsTable.vue";

/**
 * Testing Library on purpose: components are queried by role and visible text —
 * the way a user or screen reader reaches them — not by internals or classes.
 */

describe("MetricTiles", () => {
  const metrics = {
    currency: "USD",
    grossVolumeMinor: 122_200,
    succeededCount: 3,
    successRate: 75,
    pending: { amountMinor: 22_750, count: 2 },
    eventsRecorded: 5,
    dailyVolume: [],
  };

  it("renders exact currency amounts — $227.50, not $228", () => {
    render(MetricTiles, { props: { metrics } });

    expect(screen.getByText("$1,222.00")).toBeTruthy();
    expect(screen.getByText("$227.50")).toBeTruthy();
    expect(screen.getByText("75% success rate")).toBeTruthy();
  });

  it("says there is no success rate rather than showing 0%", () => {
    render(MetricTiles, { props: { metrics: { ...metrics, successRate: null } } });

    expect(screen.getByText("No settled payments yet")).toBeTruthy();
    expect(screen.queryByText(/0% success rate/)).toBeNull();
  });
});

describe("HealthPanel", () => {
  const health = {
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
  };

  it("reports the live count it is given and labels the down integration", () => {
    render(HealthPanel, { props: { health, liveChecks: 3 } });

    expect(screen.getByText("3 of 4 live")).toBeTruthy();
    expect(screen.getByText("Awaiting signing secret")).toBeTruthy();
    expect(screen.getByText("3 ms")).toBeTruthy();
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
              currency: "USD",
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
    expect(screen.getByText("$42.00")).toBeTruthy();
    expect(screen.getByText("succeeded")).toBeTruthy();
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
