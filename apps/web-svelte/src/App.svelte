<script lang="ts">
  import { createDashboard } from "./lib/dashboard.svelte";
  import HealthPanel from "./lib/HealthPanel.svelte";
  import OperatorPanel from "./lib/OperatorPanel.svelte";
  import MetricTiles from "./lib/MetricTiles.svelte";
  import TransactionsTable from "./lib/TransactionsTable.svelte";
  import { toMinorUnits } from "./lib/schemas";

  const dashboard = createDashboard();
  // Same memory as the other clients: pre-filled for the zero-typing path,
  // but a chosen amount survives the Stripe round trip.
  const storedAmount = window.sessionStorage.getItem("zf_last_amount");
  let amount = $state(
    storedAmount && toMinorUnits(storedAmount) !== null ? storedAmount : "42.00",
  );

  function rememberAndCheckout() {
    window.sessionStorage.setItem("zf_last_amount", amount.trim());
    dashboard.checkout(amount);
  }
  // Runes equivalent of the Vue client's computed: same shared rule, same
  // behaviour, expressed in this framework's idiom.
  const amountValid = $derived(toMinorUnits(amount) !== null);

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
    <div class="pay-group">
      <label class="amount-label" for="amount">
        Test payment amount in US dollars
      </label>
      <div class="amount-field" class:invalid={!amountValid}>
        <span aria-hidden="true">$</span>
        <input
          id="amount"
          bind:value={amount}
          type="text"
          inputmode="decimal"
          autocomplete="off"
          aria-describedby="amount-hint"
          aria-invalid={!amountValid}
          onkeyup={(event) => {
            if (event.key === "Enter") rememberAndCheckout();
          }}
        />
      </div>
      <p id="amount-hint" class="amount-hint" class:invalid={!amountValid}>
        Any amount from $0.50 to $10,000.00
      </p>
      <button
        type="button"
        class="pay"
        disabled={dashboard.checkoutPending}
        onclick={rememberAndCheckout}
      >
        {dashboard.checkoutPending ? "Opening Stripe…" : "+ Test payment"}
      </button>
    </div>
  </header>

  {#if dashboard.checkoutError}
    <p role="alert" class="error">{dashboard.checkoutError}</p>
  {/if}

  {#if dashboard.state === "loading"}
    <p role="status" class="loading">Loading live data…</p>
  {:else if dashboard.state === "error"}
    <div role="alert" class="error-block">
      <p class="error">
        The API did not respond — it runs on a free tier and may be waking from
        sleep, which takes about half a minute.
      </p>
      <button type="button" class="retry" onclick={() => dashboard.load()}>
        Try again
      </button>
      <p class="error-detail">{dashboard.errors.join(" · ")}</p>
    </div>
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

  <OperatorPanel />

  <footer class="foot">
    <span>ZEROFAYYZ FINTECH · Portfolio Prototype · Svelte 5 client</span>
    <span>Sandbox data only · No real funds processed</span>
  </footer>
</div>

<style>
  .pay-group {
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    gap: 0.5rem;
  }

  .amount-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .amount-field {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 0.55rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.75rem;
    background: #16241f;
    color: rgba(255, 255, 255, 0.4);
  }

  .amount-field.invalid {
    border-color: rgba(253, 164, 175, 0.55);
  }

  .amount-field input {
    width: 5rem;
    padding: 0.6rem 0;
    border: 0;
    background: transparent;
    color: #fff;
    font: inherit;
    font-weight: 600;
    font-size: 0.78rem;
    outline: none;
  }

  .amount-field.invalid input {
    color: #fda4af;
  }

  /* Visible to everyone, not only to a screen reader: a limit nobody can see
     is a limit people discover by being refused. */
  .amount-hint {
    grid-column: 1 / -1;
    order: 3;
    margin: 0;
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .amount-hint.invalid {
    color: #fda4af;
  }

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
  .error-block {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }
  .error-detail {
    color: rgba(253, 164, 175, 0.6);
    font-size: 11px;
    margin: 0;
  }
  .retry {
    background: transparent;
    border: 1px solid rgba(110, 231, 183, 0.4);
    border-radius: 10px;
    color: #6ee7b7;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    padding: 8px 14px;
  }
  .retry:hover {
    background: rgba(110, 231, 183, 0.08);
  }
  .foot {
    color: rgba(255, 255, 255, 0.55);
    display: flex;
    font-size: 10px;
    justify-content: space-between;
    margin-top: 12px;
  }
</style>
