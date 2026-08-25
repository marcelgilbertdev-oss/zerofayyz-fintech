import { fetchHealth, fetchMetrics, fetchTransactions, startCheckout } from "./api";
import { toMinorUnits } from "./schemas";
import type { Health, Metrics, Transactions } from "./schemas";

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * Svelte 5 runes as the state layer — the direct counterpart to the Vue
 * client's Pinia store, deliberately with the same semantics so the two are
 * comparable: three fetches settle independently, and a single failing
 * endpoint degrades one panel rather than blanking the page.
 */
/**
 * Optional seed from SvelteKit's `load`.
 *
 * When the framework has already fetched the page's data there is nothing to
 * wait for, so the store starts in "ready" rather than replaying the same
 * three requests on mount. Called with no argument it behaves exactly as
 * before, which is what keeps the store testable without a framework around
 * it — and what let the existing suite carry over unchanged.
 */
export type DashboardSeed = {
  health: Health | null;
  metrics: Metrics | null;
  transactions: Transactions | null;
  errors: string[];
};

export function createDashboard(seed?: DashboardSeed) {
  let state = $state<LoadState>(
    seed ? (seed.health || seed.metrics || seed.transactions ? "ready" : "error") : "idle",
  );
  let health = $state<Health | null>(seed?.health ?? null);
  let metrics = $state<Metrics | null>(seed?.metrics ?? null);
  let transactions = $state<Transactions | null>(seed?.transactions ?? null);
  let errors = $state<string[]>(seed?.errors ?? []);
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

  async function checkout(amount: string = "4200") {
    const amountMinor = toMinorUnits(amount);

    // Refused here rather than round-tripping to the API for a 400 the user
    // would have to wait through. The route schema still validates it.
    if (amountMinor === null) {
      checkoutError = "Enter an amount between ¥50 and ¥1,500,000";
      return;
    }

    checkoutPending = true;
    checkoutError = null;

    try {
      window.location.assign(await startCheckout(amountMinor));
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
