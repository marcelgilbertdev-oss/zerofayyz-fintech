import { f as fetchHealth, a as fetchMetrics, b as fetchTransactions } from "../../chunks/api.js";
const load = async ({ fetch }) => {
  const [health, metrics, transactions] = await Promise.allSettled([
    fetchHealth(fetch),
    fetchMetrics(fetch),
    fetchTransactions(fetch)
  ]);
  const errors = [];
  for (const settled of [health, metrics, transactions]) {
    if (settled.status === "rejected") {
      errors.push(String(settled.reason?.message ?? settled.reason));
    }
  }
  return {
    health: health.status === "fulfilled" ? health.value : null,
    metrics: metrics.status === "fulfilled" ? metrics.value : null,
    transactions: transactions.status === "fulfilled" ? transactions.value : null,
    errors
  };
};
export {
  load
};
