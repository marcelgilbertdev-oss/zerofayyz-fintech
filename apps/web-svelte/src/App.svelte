<script lang="ts">
  import { createDashboard } from "./lib/dashboard.svelte";
  import HealthPanel from "./lib/HealthPanel.svelte";
  import MetricTiles from "./lib/MetricTiles.svelte";
  import TransactionsTable from "./lib/TransactionsTable.svelte";

  const dashboard = createDashboard();

  $effect(() => {
    void dashboard.load();
  });
</script>

<div class="shell">
  <header class="top">
    <div>
      <p class="brand">ZEROFAYYZ <span>FINTECH</span></p>
      <p class="tagline">Svelte 5 client · same API, same ledger, different framework</p>
    </div>
    <button
      type="button"
      class="pay"
      disabled={dashboard.checkoutPending}
      onclick={() => dashboard.checkout()}
    >
      {dashboard.checkoutPending ? "Opening Stripe…" : "+ Test payment"}
    </button>
  </header>

  {#if dashboard.checkoutError}
    <p role="alert" class="error">{dashboard.checkoutError}</p>
  {/if}

  {#if dashboard.state === "loading"}
    <p role="status" class="loading">Loading live data…</p>
  {:else if dashboard.state === "error"}
    <p role="alert" class="error">
      The API is unreachable. {dashboard.errors.join(" · ")}
    </p>
  {:else if dashboard.state === "ready"}
    {#if dashboard.metrics}
      <MetricTiles metrics={dashboard.metrics} />
    {/if}

    <div class="columns">
      {#if dashboard.transactions}
        <TransactionsTable transactions={dashboard.transactions} />
      {/if}
      {#if dashboard.health}
        <HealthPanel health={dashboard.health} liveChecks={dashboard.liveChecks} />
      {/if}
    </div>

    {#if dashboard.errors.length > 0}
      <p role="alert" class="error">
        Some panels failed to load: {dashboard.errors.join(" · ")}
      </p>
    {/if}
  {/if}

  <footer class="foot">
    <span>ZEROFAYYZ FINTECH · Portfolio Prototype · Svelte 5 client</span>
    <span>Sandbox data only · No real funds processed</span>
  </footer>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 0 auto;
    max-width: 1100px;
    padding: 28px 20px 40px;
  }
  .top {
    align-items: center;
    display: flex;
    justify-content: space-between;
  }
  .brand {
    color: #fff;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.08em;
    margin: 0;
  }
  .brand span {
    color: rgba(110, 231, 183, 0.8);
    font-weight: 500;
  }
  .tagline {
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
    margin: 4px 0 0;
  }
  .pay {
    background: #6ee7b7;
    border: 0;
    border-radius: 12px;
    color: #062018;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    padding: 10px 16px;
  }
  .pay:disabled {
    cursor: wait;
    opacity: 0.6;
  }
  .columns {
    display: grid;
    gap: 16px;
    grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.8fr);
  }
  @media (max-width: 860px) {
    .columns {
      grid-template-columns: 1fr;
    }
  }
  .loading,
  .error {
    color: rgba(255, 255, 255, 0.75);
    font-size: 13px;
    margin: 0;
  }
  .error {
    color: #fda4af;
  }
  .foot {
    color: rgba(255, 255, 255, 0.55);
    display: flex;
    font-size: 10px;
    justify-content: space-between;
    margin-top: 12px;
  }
</style>
