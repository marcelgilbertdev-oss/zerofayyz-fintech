#!/usr/bin/env node
/**
 * Load test with an asserted baseline.
 *
 *   node scripts/load-test.mjs                    # against the deployed API
 *   TARGET=http://127.0.0.1:4000 node scripts/load-test.mjs
 *
 * Deliberately dependency-free: Node's fetch and a concurrency pool are enough
 * for read endpoints, and a load test nobody can run because of a missing tool
 * is a load test nobody runs.
 *
 * What it is NOT: a capacity plan. The free tier is one shared instance and a
 * serverless database that sleeps. These thresholds assert "no regression and no
 * errors under modest concurrency", which is the honest claim available here.
 * Exits non-zero when a threshold is breached, so CI can gate on it.
 */

const TARGET = process.env.TARGET ?? "https://zerofayyz-fintech-api.onrender.com";
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY ?? "10", 10);
const REQUESTS = Number.parseInt(process.env.REQUESTS ?? "120", 10);
const WARMUP_MS = Number.parseInt(process.env.WARMUP_MS ?? "90000", 10);

/**
 * Thresholds are per-endpoint because they do different work: /health runs one
 * trivial query, /metrics runs two aggregates over a generated date series.
 */
const SCENARIOS = [
  { name: "health", path: "/api/v1/health", p95Ms: 1500, maxErrorRate: 0 },
  { name: "metrics", path: "/api/v1/metrics", p95Ms: 2000, maxErrorRate: 0 },
  { name: "transactions", path: "/api/v1/transactions", p95Ms: 2000, maxErrorRate: 0 },
];

function percentile(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function warmUp() {
  // The free instance sleeps after inactivity; a cold start would otherwise be
  // measured as latency and make the numbers a lie.
  const startedAt = performance.now();
  process.stdout.write("  warming up… ");

  while (performance.now() - startedAt < WARMUP_MS) {
    try {
      const response = await fetch(`${TARGET}/api/v1/health`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        console.log(`awake after ${Math.round(performance.now() - startedAt)}ms`);
        return true;
      }
    } catch {
      // still asleep
    }
  }

  console.log("gave up waiting");
  return false;
}

async function runScenario(scenario) {
  const latencies = [];
  let errors = 0;
  let inFlight = 0;
  let issued = 0;

  const startedAt = performance.now();

  await new Promise((resolve) => {
    const pump = () => {
      while (inFlight < CONCURRENCY && issued < REQUESTS) {
        issued += 1;
        inFlight += 1;

        const requestStart = performance.now();

        fetch(`${TARGET}${scenario.path}`, { signal: AbortSignal.timeout(30_000) })
          .then((response) => {
            if (!response.ok) errors += 1;
            return response.arrayBuffer();
          })
          .catch(() => {
            errors += 1;
          })
          .finally(() => {
            latencies.push(performance.now() - requestStart);
            inFlight -= 1;
            if (issued >= REQUESTS && inFlight === 0) resolve();
            else pump();
          });
      }
    };

    pump();
  });

  const wallMs = performance.now() - startedAt;
  const sorted = [...latencies].sort((a, b) => a - b);

  return {
    name: scenario.name,
    requests: latencies.length,
    errors,
    errorRate: errors / Math.max(1, latencies.length),
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
    max: Math.round(sorted.at(-1) ?? 0),
    rps: Math.round((latencies.length / wallMs) * 1000 * 10) / 10,
    thresholds: { p95Ms: scenario.p95Ms, maxErrorRate: scenario.maxErrorRate },
  };
}

console.log(`\nLoad test — ${TARGET}`);
console.log(`  ${REQUESTS} requests per endpoint, ${CONCURRENCY} concurrent\n`);

await warmUp();

const results = [];

for (const scenario of SCENARIOS) {
  results.push(await runScenario(scenario));
}

console.log("\n  endpoint       reqs  errors    p50    p95    p99    max    rps");
console.log("  " + "-".repeat(64));

const failures = [];

for (const result of results) {
  console.log(
    `  ${result.name.padEnd(13)} ${String(result.requests).padStart(4)} ` +
      `${String(result.errors).padStart(7)} ` +
      `${String(result.p50).padStart(6)} ${String(result.p95).padStart(6)} ` +
      `${String(result.p99).padStart(6)} ${String(result.max).padStart(6)} ` +
      `${String(result.rps).padStart(6)}`,
  );

  if (result.errorRate > result.thresholds.maxErrorRate) {
    failures.push(
      `${result.name}: error rate ${(result.errorRate * 100).toFixed(1)}% exceeds ` +
        `${(result.thresholds.maxErrorRate * 100).toFixed(1)}%`,
    );
  }
  if (result.p95 > result.thresholds.p95Ms) {
    failures.push(`${result.name}: p95 ${result.p95}ms exceeds ${result.thresholds.p95Ms}ms`);
  }
}

console.log();

if (failures.length > 0) {
  console.log("THRESHOLD BREACHES:");
  for (const failure of failures) console.log(`  - ${failure}`);
  console.log();
  process.exit(1);
}

console.log(`All ${results.length} endpoints within thresholds.\n`);
