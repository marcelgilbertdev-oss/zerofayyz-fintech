import type { PageLoad } from "./$types";

import { fetchHealth, fetchMetrics, fetchTransactions } from "$lib/api";
import type { Health, Metrics, Transactions } from "$lib/schemas";

/**
 * The dashboard's data, loaded by the framework rather than by an effect in a
 * component.
 *
 * SvelteKit's `load` runs before the page renders and its result arrives as
 * `data`, so the component has no "loading" branch to write and no chance to
 * render an empty shell first. `fetch` is SvelteKit's instrumented version —
 * it is passed in rather than reached for globally, which is what lets the
 * framework track the request.
 *
 * The partial-failure posture from the pre-Kit client is preserved exactly:
 * three reads settle independently with `allSettled`, and a single failing
 * endpoint degrades one panel instead of blanking the page. That behaviour was
 * the point of the original design and it survives the migration — the client
 * suite asserts it either way.
 */
export const load: PageLoad = async ({ fetch }) => {
  const [health, metrics, transactions] = await Promise.allSettled([
    fetchHealth(fetch),
    fetchMetrics(fetch),
    fetchTransactions(fetch),
  ]);

  const errors: string[] = [];

  for (const settled of [health, metrics, transactions]) {
    if (settled.status === "rejected") {
      errors.push(String(settled.reason?.message ?? settled.reason));
    }
  }

  return {
    health: health.status === "fulfilled" ? (health.value as Health) : null,
    metrics: metrics.status === "fulfilled" ? (metrics.value as Metrics) : null,
    transactions:
      transactions.status === "fulfilled" ? (transactions.value as Transactions) : null,
    errors,
  };
};
