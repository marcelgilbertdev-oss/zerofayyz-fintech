import { fetchHealth, fetchMetrics, fetchTransactions, startCheckout } from "./api";
import type { Health, Metrics, Transactions } from "./schemas";

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * Svelte 5 runes as the state layer — the direct counterpart to the Vue
 * client's Pinia store, deliberately with the same semantics so the two are
 * comparable: three fetches settle independently, and a single failing
 * endpoint degrades one panel rather than blanking the page.
 */
export function createDashboard() {
  let state = $state<LoadState>("idle");
  let health = $state<Health | null>(null);
  let metrics = $state<Metrics | null>(null);
  let transactions = $state<Transactions | null>(null);
  let errors = $state<string[]>([]);
  let checkoutPending = $state(false);
  let checkoutError = $state<string | null>(null);

  const liveChecks = $derived.by(() => {
    if (!health) return 0;
    const { database, stripe, webhook } = health.checks;
    return [
      health.status === "operational",
      database.status === "operational",
      stripe.status === "configured",
      webhook.status === "configured",
    ].filter(Boolean).length;
  });

  async function load() {
    state = "loading";
    errors = [];

    const settled = await Promise.allSettled([
      fetchHealth(),
      fetchMetrics(),
      fetchTransactions(),
    ]);

    const [healthResult, metricsResult, transactionsResult] = settled;

    health = healthResult.status === "fulfilled" ? healthResult.value : null;
    metrics = metricsResult.status === "fulfilled" ? metricsResult.value : null;
    transactions =
      transactionsResult.status === "fulfilled" ? transactionsResult.value : null;

    errors = settled
      .filter((entry) => entry.status === "rejected")
      .map((entry) => String((entry as PromiseRejectedResult).reason?.message ??
        (entry as PromiseRejectedResult).reason));

    // "error" only when nothing loaded; partial data is still a dashboard.
    state = health || metrics || transactions ? "ready" : "error";
  }

  async function checkout() {
    checkoutPending = true;
    checkoutError = null;

    try {
      window.location.assign(await startCheckout());
    } catch (error) {
      checkoutError =
        error instanceof Error ? error.message : "Unable to start checkout";
      checkoutPending = false;
    }
  }

  return {
    get state() { return state; },
    get health() { return health; },
    get metrics() { return metrics; },
    get transactions() { return transactions; },
    get errors() { return errors; },
    get checkoutPending() { return checkoutPending; },
    get checkoutError() { return checkoutError; },
    get liveChecks() { return liveChecks; },
    load,
    checkout,
  };
}
