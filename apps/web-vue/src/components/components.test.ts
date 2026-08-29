import { createPinia, setActivePinia } from "pinia";
import { render, screen } from "@testing-library/vue";
import { beforeEach, describe, expect, it } from "vitest";

import App from "../App.vue";
import HealthPanel from "./HealthPanel.vue";
import MetricTiles from "./MetricTiles.vue";
import TransactionsTable from "./TransactionsTable.vue";

/**
 * Testing Library on purpose: components are queried by role and visible text —
 * the way a user or screen reader reaches them — not by internals or classes.
 */

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

/**
 * The operator area sits at the bottom of a single page (ADR 0010), which is right —
 * a router existing only to host a login page is ceremony. But a reviewer who does not
 * scroll never sees the session cookie, role guard, rate limiter or audit trail, so the
 * header carries a door to it. And the platform's claim that one API serves three
 * clients is only checkable if the other two are reachable from here.
 *
 * These assert rendered output, not the deployment: this client ships a shell and
 * renders in the browser, so a smoke test fetching its HTML sees an empty div.
 */
describe("App shell", () => {
  // App mounts the dashboard store on setup, so it needs a Pinia — the same
  // arrangement the store suite uses.
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("carries a header door to the operator area, and the area it points at", () => {
    render(App);

    const door = screen.getByRole("link", { name: /operator sign-in/i });
    expect(door.getAttribute("href")).toBe("#operator");
    expect(document.querySelector("#operator")).not.toBeNull();
  });

  it("links to the other two clients, so one API serving three is verifiable", () => {
    render(App);

    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("zerofayyz-fintech.vercel.app"))).toBe(true);
    expect(hrefs.some((h) => h.includes("fintech-svelte.vercel.app"))).toBe(true);
  });

  it("labels the amount field in yen — the currency it actually renders", () => {
    render(App);

    // A <label for>, so a screen reader announces it; it said "US dollars" over a ¥ field.
    expect(screen.getByLabelText(/japanese yen/i)).toBeTruthy();
  });
});
