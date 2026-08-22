import { a3 as derived, e as escape_html, a4 as ensure_array_like, a5 as attr_class, a6 as attr } from "../../chunks/index.js";
import { t as toMinorUnits, s as startCheckout, f as fetchHealth, a as fetchMetrics, b as fetchTransactions } from "../../chunks/api.js";
import "clsx";
function createDashboard(seed) {
  let state = seed ? seed.health || seed.metrics || seed.transactions ? "ready" : "error" : "idle";
  let health = seed?.health ?? null;
  let metrics = seed?.metrics ?? null;
  let transactions = seed?.transactions ?? null;
  let errors = seed?.errors ?? [];
  let checkoutPending = false;
  let checkoutError = null;
  const liveChecks = derived(() => {
    if (!health) return 0;
    const { database, stripe, webhook } = health.checks;
    return [
      health.status === "operational",
      database.status === "operational",
      stripe.status === "configured",
      webhook.status === "configured"
    ].filter(Boolean).length;
  });
  async function load() {
    state = "loading";
    errors = [];
    const settled = await Promise.allSettled([fetchHealth(), fetchMetrics(), fetchTransactions()]);
    const [healthResult, metricsResult, transactionsResult] = settled;
    health = healthResult.status === "fulfilled" ? healthResult.value : null;
    metrics = metricsResult.status === "fulfilled" ? metricsResult.value : null;
    transactions = transactionsResult.status === "fulfilled" ? transactionsResult.value : null;
    errors = settled.filter((entry) => entry.status === "rejected").map((entry) => String(entry.reason?.message ?? entry.reason));
    state = health || metrics || transactions ? "ready" : "error";
  }
  async function checkout(amount = "42.00") {
    const amountMinor = toMinorUnits(amount);
    if (amountMinor === null) {
      checkoutError = "Enter an amount between $0.50 and $10,000.00";
      return;
    }
    checkoutPending = true;
    checkoutError = null;
    try {
      window.location.assign(await startCheckout(amountMinor));
    } catch (error) {
      checkoutError = error instanceof Error ? error.message : "Unable to start checkout";
      checkoutPending = false;
    }
  }
  return {
    get state() {
      return state;
    },
    get health() {
      return health;
    },
    get metrics() {
      return metrics;
    },
    get transactions() {
      return transactions;
    },
    get errors() {
      return errors;
    },
    get checkoutPending() {
      return checkoutPending;
    },
    get checkoutError() {
      return checkoutError;
    },
    get liveChecks() {
      return liveChecks();
    },
    load,
    checkout
  };
}
function HealthPanel($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const { health, liveChecks } = $$props;
    const rows = derived(() => {
      const { database, stripe, webhook } = health.checks;
      return [
        {
          label: "API service",
          detail: `v${health.version}`,
          healthy: health.status === "operational"
        },
        {
          label: "PostgreSQL",
          detail: database.latencyMs === null ? "Unavailable" : `${database.latencyMs} ms`,
          healthy: database.status === "operational"
        },
        {
          label: "Stripe sandbox",
          detail: stripe.status === "configured" ? "Test API access" : "Awaiting test key",
          healthy: stripe.status === "configured"
        },
        {
          label: "Webhook queue",
          detail: webhook.status === "configured" ? "Signature verification" : "Awaiting signing secret",
          healthy: webhook.status === "configured"
        }
      ];
    });
    $$renderer2.push(`<section aria-label="System health" class="panel svelte-qqv6rz"><header class="panel-header svelte-qqv6rz"><h2 class="svelte-qqv6rz">System health</h2> <span class="badge svelte-qqv6rz">${escape_html(liveChecks)} of 4 live</span></header> <ul class="checks svelte-qqv6rz"><!--[-->`);
    const each_array = ensure_array_like(rows());
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let row = each_array[$$index];
      $$renderer2.push(`<li class="check svelte-qqv6rz"><span${attr_class("dot svelte-qqv6rz", void 0, { "healthy": row.healthy })} aria-hidden="true"></span> <div><p class="check-label svelte-qqv6rz">${escape_html(row.label)}</p> <p class="check-detail svelte-qqv6rz">${escape_html(row.detail)}</p></div> <span class="check-status svelte-qqv6rz">${escape_html(row.healthy ? "Live" : "Down")}</span></li>`);
    }
    $$renderer2.push(`<!--]--></ul></section>`);
  });
}
function money(amountMinor, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amountMinor / 100
  );
}
function relative(iso) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 6e4)
  );
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  return minutes < 60 ? formatter.format(-minutes, "minute") : formatter.format(-Math.round(minutes / 60), "hour");
}
function MetricTiles($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const { metrics } = $$props;
    const tiles = derived(() => [
      {
        label: "Gross volume",
        value: money(metrics.grossVolumeMinor, metrics.currency),
        note: `${metrics.succeededCount} succeeded`
      },
      {
        label: "Successful payments",
        value: String(metrics.succeededCount),
        note: metrics.successRate === null ? "No settled payments yet" : `${metrics.successRate}% success rate`
      },
      {
        label: "Pending settlement",
        value: money(metrics.pending.amountMinor, metrics.currency),
        note: `${metrics.pending.count} processing`
      },
      {
        label: "Webhook events",
        value: String(metrics.eventsRecorded),
        note: "Deduplicated by Stripe event id"
      }
    ]);
    $$renderer2.push(`<section aria-label="Key metrics" class="tiles svelte-fz0cjk"><!--[-->`);
    const each_array = ensure_array_like(tiles());
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let tile = each_array[$$index];
      $$renderer2.push(`<article class="tile svelte-fz0cjk"><p class="tile-label svelte-fz0cjk">${escape_html(tile.label)}</p> <p class="tile-value svelte-fz0cjk">${escape_html(tile.value)}</p> <p class="tile-note svelte-fz0cjk">${escape_html(tile.note)}</p></article>`);
    }
    $$renderer2.push(`<!--]--></section>`);
  });
}
function OperatorPanel($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      $$renderer3.push(`<section aria-label="Operator area" class="panel svelte-1qnc58h"><header class="panel-header svelte-1qnc58h"><h2 class="svelte-1qnc58h">Operator area</h2> <p class="source svelte-1qnc58h">The dashboard above is public. This door is for the operational half —
      the same session cookie, rate limiter and audit trail as the admin
      console, driven from Svelte this time.</p></header> `);
      {
        $$renderer3.push("<!--[0-->");
        $$renderer3.push(`<p class="checking svelte-1qnc58h" role="status">Checking session…</p>`);
      }
      $$renderer3.push(`<!--]--></section>`);
    }
    do {
      $$settled = true;
      $$inner_renderer = $$renderer2.copy();
      $$render_inner($$inner_renderer);
    } while (!$$settled);
    $$renderer2.subsume($$inner_renderer);
  });
}
function TransactionsTable($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const { transactions } = $$props;
    $$renderer2.push(`<section aria-label="Recent transactions" class="panel svelte-lfb9ji"><header><h2 class="svelte-lfb9ji">Recent transactions</h2> <p class="source svelte-lfb9ji">Live sandbox records from PostgreSQL</p></header> <div class="scroll svelte-lfb9ji"><table class="svelte-lfb9ji"><thead><tr><th scope="col" class="svelte-lfb9ji">Customer</th><th scope="col" class="svelte-lfb9ji">Amount</th><th scope="col" class="svelte-lfb9ji">Method</th><th scope="col" class="svelte-lfb9ji">Status</th><th scope="col" class="right svelte-lfb9ji">Time</th></tr></thead><tbody><!--[-->`);
    const each_array = ensure_array_like(transactions.data);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let row = each_array[$$index];
      $$renderer2.push(`<tr><td class="svelte-lfb9ji"><p class="name svelte-lfb9ji">${escape_html(row.customer.displayName)}</p> <p class="email svelte-lfb9ji">${escape_html(row.customer.email)}</p></td><td class="amount svelte-lfb9ji">${escape_html(money(row.amountMinor, row.currency))}</td><td class="muted svelte-lfb9ji">${escape_html(row.methodLabel)}</td><td class="svelte-lfb9ji"><span class="status svelte-lfb9ji"${attr("data-status", row.status)}>${escape_html(row.status)}</span></td><td class="muted right svelte-lfb9ji">${escape_html(relative(row.createdAt))}</td></tr>`);
    }
    $$renderer2.push(`<!--]-->`);
    if (transactions.data.length === 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<tr><td colspan="5" class="empty svelte-lfb9ji">No transactions yet.</td></tr>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></tbody></table></div></section>`);
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    const dashboard = createDashboard(data);
    const storedAmount = globalThis.sessionStorage?.getItem("zf_last_amount");
    let amount = storedAmount && toMinorUnits(storedAmount) !== null ? storedAmount : "42.00";
    const amountValid = derived(() => toMinorUnits(amount) !== null);
    $$renderer2.push(`<div class="shell svelte-1uha8ag"><header class="top svelte-1uha8ag"><div><p class="brand svelte-1uha8ag">ZEROFAYYZ <span class="svelte-1uha8ag">FINTECH</span></p> <p class="tagline svelte-1uha8ag">Svelte 5 client · same API, same ledger, different framework</p></div> <div class="pay-group svelte-1uha8ag"><label class="amount-label svelte-1uha8ag" for="amount">Test payment amount in US dollars</label> <div${attr_class("amount-field svelte-1uha8ag", void 0, { "invalid": !amountValid() })}><span aria-hidden="true">$</span> <input id="amount"${attr("value", amount)} type="text" inputmode="decimal" autocomplete="off" aria-describedby="amount-hint"${attr("aria-invalid", !amountValid())} class="svelte-1uha8ag"/></div> <p id="amount-hint"${attr_class("amount-hint svelte-1uha8ag", void 0, { "invalid": !amountValid() })}>Any amount from $0.50 to $10,000.00</p> <button type="button" class="pay svelte-1uha8ag"${attr("disabled", dashboard.checkoutPending, true)}>${escape_html(dashboard.checkoutPending ? "Opening Stripe…" : "+ Test payment")}</button></div></header> `);
    if (dashboard.checkoutError) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p role="alert" class="error svelte-1uha8ag">${escape_html(dashboard.checkoutError)}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (dashboard.state === "loading") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p role="status" class="loading svelte-1uha8ag">Loading live data…</p>`);
    } else if (dashboard.state === "error") {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<div role="alert" class="error-block svelte-1uha8ag"><p class="error svelte-1uha8ag">The API did not respond — it runs on a free tier and may be waking from
        sleep, which takes about half a minute.</p> <button type="button" class="retry svelte-1uha8ag">Try again</button> <p class="error-detail svelte-1uha8ag">${escape_html(dashboard.errors.join(" · "))}</p></div>`);
    } else if (dashboard.state === "ready") {
      $$renderer2.push("<!--[2-->");
      if (dashboard.metrics) {
        $$renderer2.push("<!--[0-->");
        MetricTiles($$renderer2, { metrics: dashboard.metrics });
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <div class="columns svelte-1uha8ag">`);
      if (dashboard.transactions) {
        $$renderer2.push("<!--[0-->");
        TransactionsTable($$renderer2, { transactions: dashboard.transactions });
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if (dashboard.health) {
        $$renderer2.push("<!--[0-->");
        HealthPanel($$renderer2, { health: dashboard.health, liveChecks: dashboard.liveChecks });
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div> `);
      if (dashboard.errors.length > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<p role="alert" class="error svelte-1uha8ag">Some panels failed to load: ${escape_html(dashboard.errors.join(" · "))}</p>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    OperatorPanel($$renderer2);
    $$renderer2.push(`<!----> <footer class="foot svelte-1uha8ag"><span>ZEROFAYYZ FINTECH · Portfolio Prototype · Svelte 5 client</span> <span>Sandbox data only · No real funds processed</span></footer></div>`);
  });
}
export {
  _page as default
};
