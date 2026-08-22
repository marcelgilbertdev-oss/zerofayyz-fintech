#!/usr/bin/env node
/**
 * Production smoke suite.
 *
 * Checks the deployed platform from the outside, the way a stranger reaches it:
 * no database credentials, no Stripe key, no privileged access. Everything here
 * is verifiable by anyone holding only the two public URLs.
 *
 *   node scripts/production-smoke.mjs
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 */

const API = process.env.SMOKE_API_URL ?? "https://zerofayyz-fintech-api.onrender.com";
const WEB = process.env.SMOKE_WEB_URL ?? "https://zerofayyz-fintech.vercel.app";
// The free tier sleeps; the first request may pay a cold start.
const TIMEOUT_MS = Number.parseInt(process.env.SMOKE_TIMEOUT_MS ?? "90000", 10);

const results = [];

async function check(name, run) {
  const startedAt = performance.now();

  try {
    const detail = await run();
    const ms = Math.round(performance.now() - startedAt);
    results.push({ name, ok: true, detail, ms });
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""} (${ms}ms)`);
  } catch (error) {
    const ms = Math.round(performance.now() - startedAt);
    results.push({ name, ok: false, detail: String(error.message ?? error), ms });
    console.log(`  FAIL  ${name} — ${error.message ?? error} (${ms}ms)`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(path, init) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  return { response, body: await response.json().catch(() => null) };
}

console.log(`\nProduction smoke suite`);
console.log(`  api: ${API}`);
console.log(`  web: ${WEB}\n`);

await check("health responds and reports every dependency", async () => {
  const { response, body } = await fetchJson("/api/v1/health");

  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(body.checks.database.status === "operational", "database is not operational");
  assert(typeof body.checks.database.latencyMs === "number", "no database latency reported");
  assert(body.checks.stripe.status === "configured", "Stripe is not configured");
  assert(body.checks.webhook.status === "configured", "webhook signing is not configured");

  return `db ${body.checks.database.latencyMs}ms, env ${body.environment}`;
});

await check("metrics are internally consistent", async () => {
  const { response, body } = await fetchJson("/api/v1/metrics");

  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(body.currency === "USD", "metrics are not scoped to a currency");
  assert(Number.isInteger(body.grossVolumeMinor), "gross volume is not an integer of minor units");
  assert(body.dailyVolume.length === 12, `expected 12 daily buckets, got ${body.dailyVolume.length}`);

  // A success rate must be null or a percentage; never a silent zero.
  assert(
    body.successRate === null || (body.successRate >= 0 && body.successRate <= 100),
    `success rate out of range: ${body.successRate}`,
  );
  // Gross volume counts succeeded payments, so one implies the other.
  assert(
    (body.succeededCount === 0) === (body.grossVolumeMinor === 0),
    "gross volume and succeeded count disagree",
  );

  return `$${(body.grossVolumeMinor / 100).toFixed(2)} across ${body.succeededCount} payments, ${body.eventsRecorded} events`;
});

await check("transactions are served from PostgreSQL", async () => {
  const { response, body } = await fetchJson("/api/v1/transactions");

  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(body.meta.source === "postgresql", "transactions are not sourced from PostgreSQL");
  assert(Array.isArray(body.data), "transactions payload is not a list");
  assert(body.data.length === body.meta.count, "meta.count disagrees with the row count");

  // DISTINCT ON collapses events per payment, so ids must be unique.
  const ids = new Set(body.data.map((row) => row.id));
  assert(ids.size === body.data.length, "duplicate transaction ids returned");

  return `${body.data.length} rows, all distinct`;
});

await check("an unsigned webhook is rejected", async () => {
  const { response, body } = await fetchJson("/api/v1/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "evt_smoke_unsigned", type: "checkout.session.completed" }),
  });

  assert(response.status === 400, `expected 400, got ${response.status}`);
  assert(typeof body.error === "string", "no error message returned");

  return body.error;
});

await check("a forged signature is rejected", async () => {
  const { response, body } = await fetchJson("/api/v1/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=1,v1=forged",
    },
    body: JSON.stringify({ id: "evt_smoke_forged", type: "checkout.session.completed" }),
  });

  assert(response.status === 400, `expected 400, got ${response.status}`);

  return body.error;
});

await check("forged webhooks left the ledger untouched", async () => {
  const { body } = await fetchJson("/api/v1/metrics");
  const before = results.find((entry) => entry.name.startsWith("metrics"));

  assert(before?.ok, "cannot compare — the metrics check did not pass");
  assert(
    before.detail.includes(`${body.eventsRecorded} events`),
    `event count moved after forged requests: now ${body.eventsRecorded}`,
  );

  return `still ${body.eventsRecorded} events`;
});

await check("unknown API routes 404 rather than leaking", async () => {
  const { response } = await fetchJson("/api/v1/definitely-not-a-route");

  assert(response.status === 404, `expected 404, got ${response.status}`);

  return "404";
});

await check("the dashboard renders live data, not placeholders", async () => {
  const response = await fetch(WEB, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const html = await response.text();

  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(html.includes("Live sandbox records from PostgreSQL"), "transactions table is not live");
  assert(html.includes("Operational"), "no health tile reports operational");

  // The figures the dashboard used to hardcode. Their return means the page has
  // stopped reading the ledger.
  for (const placeholder of ["$48,920", "1,284", "98.7%", "0.18%"]) {
    assert(!html.includes(placeholder), `retired placeholder is back on the page: ${placeholder}`);
  }

  return "no placeholder figures present";
});

await check("the sandbox framing is visible to any visitor", async () => {
  const response = await fetch(WEB, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const html = await response.text();

  assert(/No real funds/i.test(html), "the no-real-funds statement is missing");
  assert(/Test mode/i.test(html), "the test-mode badge is missing");

  return "sandbox disclosure present";
});

await check("the checkout return allowlist reached production", async () => {
  // render.yaml is a blueprint, not a guarantee: env vars added there do not
  // always propagate to an already-running service. Without CLIENT_ORIGINS the
  // API silently falls back to sending every payer to the dashboard, which is
  // invisible from outside until somebody completes a real payment on the Vue
  // or Svelte client. This check is the difference between "deployed" and
  // "configured".
  const { body } = await fetchJson("/api/v1/health");
  const origins = body.checks?.clientOrigins;

  assert(origins !== undefined, "health does not report clientOrigins — API not redeployed yet");
  assert(
    origins.status === "configured",
    "CLIENT_ORIGINS is unset in production: payers will be returned to the dashboard " +
      "no matter which client they started from",
  );
  assert(origins.count >= 2, `expected at least 2 allowed client origins, got ${origins.count}`);

  return `${origins.count} client origins allowed`;
});

/**
 * The SPA clients deploy separately from the API and dashboard (prebuilt
 * output, no auto-deploy — see docs/runbooks/DEPLOYMENT.md). A stray platform
 * build once overwrote a working deployment with a 500 AFTER it had been
 * verified by hand; these checks exist so that class of breakage is caught by
 * a test run, never again by a failure email.
 */
const CLIENTS = [
  { name: "vue client", url: process.env.SMOKE_VUE_URL ?? "https://zerofayyz-fintech-vue.vercel.app", title: "Vue Client" },
  { name: "svelte client", url: process.env.SMOKE_SVELTE_URL ?? "https://zerofayyz-fintech-svelte.vercel.app", title: "Svelte Client" },
];

for (const client of CLIENTS) {
  await check(`${client.name} serves its own build`, async () => {
    const response = await fetch(client.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const html = await response.text();

    assert(response.status === 200, `expected 200, got ${response.status}`);
    // The wrong-context build served the API's output here once; the title is
    // the cheapest proof the right artifact is behind the alias.
    assert(html.includes(client.title), `page title does not identify the ${client.name}`);
    assert(/<script[^>]+type="module"/.test(html), "no module script tag — not a built SPA page");

    return "correct artifact";
  });

  await check(`${client.name} rewrites /api to the live API`, async () => {
    const response = await fetch(`${client.url}/api/v1/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    assert(response.status === 200, `expected 200, got ${response.status}`);

    const body = await response.json();
    assert(body.checks?.database?.status === "operational", "API through rewrite is not operational");

    return `same-origin rewrite live, db ${body.checks.database.latencyMs}ms`;
  });

  await check(`${client.name} serves index.html for deep links`, async () => {
    const response = await fetch(`${client.url}/some/deep/route`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await response.text();

    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(html.includes(client.title), "deep link did not fall back to the SPA shell");

    return "SPA fallback works";
  });

  await check(`${client.name} carries the auth path through its rewrite`, async () => {
    // Unauthenticated on purpose: a clean 401 with the API's own JSON proves
    // the operator panel's whole login path — rewrite, cookie domain, session
    // check — is reachable from this origin without spending a login attempt
    // or leaving audit noise in the production trail.
    const response = await fetch(`${client.url}/api/v1/auth/me`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    assert(response.status === 401, `expected 401, got ${response.status}`);

    const body = await response.json();
    assert(body.error === "Not signed in", `unexpected body: ${JSON.stringify(body)}`);

    return "staff door reachable, correctly closed";
  });
}

// ---------------------------------------------------------------- phase 2

// These assert content that exists ONLY in the Phase 2 build. The lesson they
// encode: this suite once stayed green while Vercel served a stale dashboard,
// because every check matched text the old build also contained. A smoke suite
// that cannot tell the new build from the previous one cannot detect a failed
// deploy — which is the main thing it exists to detect.

await check("the login page is live and publishes the demo credentials", async () => {
  const response = await fetch(`${WEB}/login`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const html = await response.text();

  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(html.includes("demo@zerofayyz.test"), "demo email not published on the login page");
  assert(html.includes("view-the-ledger"), "demo password not published on the login page");

  return "login page live, reviewer credentials visible";
});

await check("the admin console refuses the signed-out and redirects to login", async () => {
  const response = await fetch(`${WEB}/admin`, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  assert(
    response.status >= 300 && response.status < 400,
    `expected a redirect, got ${response.status}`,
  );
  const location = response.headers.get("location") ?? "";
  assert(location.includes("/login"), `redirects to ${location}, not /login`);

  return "signed-out /admin redirects to /login";
});

await check("the API demands authentication on the auth and admin surface", async () => {
  for (const path of ["/api/v1/auth/me", "/api/v1/admin/sessions", "/api/v1/admin/audit-logs", "/api/v1/admin/users"]) {
    const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    assert(response.status === 401, `${path} answered ${response.status} to an anonymous request`);
  }

  return "4 privileged routes all 401 anonymous";
});

await check("a login attempt with wrong credentials is refused, not errored", async () => {
  // Deliberately a nonsense account: proves the endpoint verifies rather than
  // crashes, without spending a real account's rate-limit budget.
  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "smoke@zerofayyz.test", password: "not-a-real-password" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  assert(
    response.status === 401 || response.status === 429,
    `expected 401 (or 429 under limit), got ${response.status}`,
  );

  return `verified refusal (${response.status})`;
});

await check("the dashboard header carries the sign-in door", async () => {
  const response = await fetch(`${WEB}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const html = await response.text();

  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(/href="\/login"/.test(html), "no sign-in link in the dashboard header");

  return "sign-in link present";
});

// ---------------------------------------------------------------- phase 5

await check("the three ledger pages serve real data", async () => {
  for (const [path, marker] of [
    ["/payments", "Filter by status"],
    ["/transactions", "UNIQUE-constrained"],
    ["/customers", "Settled volume"],
  ]) {
    const response = await fetch(`${WEB}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const html = await response.text();

    assert(response.status === 200, `${path} answered ${response.status}`);
    // Content that exists only in the Phase 5 build — the smoke suite must be
    // able to tell this deploy from the previous one.
    assert(html.includes(marker), `${path} is missing its Phase 5 content`);
  }

  return "payments, transactions, customers all live";
});

await check("the ledger API paginates and filters", async () => {
  // fetchJson returns { response, body } — the first version read .data off
  // the wrapper and blamed production for a test-side undefined.
  const { body: filtered } = await fetchJson("/api/v1/payments?status=succeeded&limit=5");
  assert(Array.isArray(filtered?.data), "no data array");
  for (const row of filtered.data) {
    assert(row.status === "succeeded", `filter leaked a ${row.status} payment`);
  }
  assert(typeof filtered.meta?.total === "number", "no exact total in meta");

  const { body: events } = await fetchJson("/api/v1/events?limit=5");
  assert(Array.isArray(events?.data), "no events array");

  return `${filtered.meta.total} succeeded payments, ${events.meta.total} events`;
});

const failed = results.filter((entry) => !entry.ok);

console.log(`\n${results.length - failed.length}/${results.length} checks passed\n`);

if (failed.length > 0) {
  process.exit(1);
}
