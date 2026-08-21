import { defineStore } from "pinia";

import {
  fetchHealth,
  fetchMetrics,
  fetchTransactions,
  startCheckout,
} from "../api";
import { toMinorUnits } from "../schemas";
import type { Health, Metrics, Transactions } from "../schemas";

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * One store, because the dashboard is one screen whose panels refresh
 * together. The three fetches run in parallel and settle independently, so a
 * failing metrics endpoint degrades one panel rather than blanking the page —
 * the same partial-failure posture as the Next.js client.
 */
export const useDashboardStore = defineStore("dashboard", {
  state: () => ({
    state: "idle" as LoadState,
    health: null as Health | null,
    metrics: null as Metrics | null,
    transactions: null as Transactions | null,
    errors: [] as string[],
    checkoutPending: false,
    checkoutError: null as string | null,
  }),

  getters: {
    /** Count of live integrations, mirroring the "N of 4 live" tile. */
    liveChecks(store): number {
      if (!store.health) return 0;
      const { database, stripe, webhook } = store.health.checks;
      return [
        store.health.status === "operational",
        database.status === "operational",
        stripe.status === "configured",
        webhook.status === "configured",
      ].filter(Boolean).length;
    },

    grossVolume(store): number | null {
      return store.metrics ? store.metrics.grossVolumeMinor / 100 : null;
    },
  },

  actions: {
    async load() {
      this.state = "loading";
      this.errors = [];

      const [health, metrics, transactions] = await Promise.allSettled([
        fetchHealth(),
        fetchMetrics(),
        fetchTransactions(),
      ]);

      this.health = health.status === "fulfilled" ? health.value : null;
      this.metrics = metrics.status === "fulfilled" ? metrics.value : null;
      this.transactions =
        transactions.status === "fulfilled" ? transactions.value : null;

      for (const settled of [health, metrics, transactions]) {
        if (settled.status === "rejected") {
          this.errors.push(String(settled.reason?.message ?? settled.reason));
        }
      }

      // "error" only when nothing loaded; partial data is still a dashboard.
      this.state =
        this.health || this.metrics || this.transactions ? "ready" : "error";
    },

    async checkout(amount: string = "42.00") {
      const amountMinor = toMinorUnits(amount);

      // Refused here rather than round-tripping to the API for a 400 the user
      // would have to wait through. The route schema still validates it.
      if (amountMinor === null) {
        this.checkoutError = "Enter an amount between $0.50 and $10,000.00";
        return;
      }

      this.checkoutPending = true;
      this.checkoutError = null;

      try {
        window.location.assign(await startCheckout(amountMinor));
      } catch (error) {
        this.checkoutError =
          error instanceof Error ? error.message : "Unable to start checkout";
        this.checkoutPending = false;
      }
    },
  },
});
