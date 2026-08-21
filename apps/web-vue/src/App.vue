<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import HealthPanel from "./components/HealthPanel.vue";
import MetricTiles from "./components/MetricTiles.vue";
import TransactionsTable from "./components/TransactionsTable.vue";
import { toMinorUnits } from "./schemas";
import { useDashboardStore } from "./stores/dashboard";

const store = useDashboardStore();
// Same memory as the Next dashboard: pre-filled for the zero-typing path,
// but a chosen amount survives the Stripe round trip.
const stored = window.sessionStorage.getItem("zf_last_amount");
const amount = ref(stored && toMinorUnits(stored) !== null ? stored : "42.00");

function rememberAndCheckout() {
  window.sessionStorage.setItem("zf_last_amount", amount.value.trim());
  void store.checkout(amount.value);
}
// Same rule the API enforces, from the same shared module the Svelte client
// uses — the Composition API equivalent of the React client's local state.
const amountValid = computed(() => toMinorUnits(amount.value) !== null);

onMounted(() => {
  void store.load();
});
</script>

<template>
  <div class="shell">
    <header class="top">
      <div>
        <p class="brand">ZEROFAYYZ <span>FINTECH</span></p>
        <p class="tagline">Vue 3 client · same API, same ledger, different framework</p>
      </div>
      <div class="pay-group">
        <label class="amount-label" for="amount">
          Test payment amount in US dollars
        </label>
        <div class="amount-field" :class="{ invalid: !amountValid }">
          <span aria-hidden="true">$</span>
          <input
            id="amount"
            v-model="amount"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            aria-describedby="amount-hint"
            :aria-invalid="!amountValid"
            @keyup.enter="rememberAndCheckout"
          />
        </div>
        <p id="amount-hint" class="amount-hint" :class="{ invalid: !amountValid }">
          Any amount from $0.50 to $10,000.00
        </p>
        <button
          type="button"
          class="pay"
          :disabled="store.checkoutPending"
          @click="rememberAndCheckout"
        >
          {{ store.checkoutPending ? "Opening Stripe…" : "+ Test payment" }}
        </button>
      </div>
    </header>

    <p v-if="store.checkoutError" role="alert" class="error">
      {{ store.checkoutError }}
    </p>

    <p v-if="store.state === 'loading'" class="loading" role="status">
      Loading live data…
    </p>

    <div v-else-if="store.state === 'error'" role="alert" class="error-block">
      <p class="error">
        The API did not respond — it runs on a free tier and may be waking from
        sleep, which takes about half a minute.
      </p>
      <button type="button" class="retry" @click="store.load()">Try again</button>
      <p class="error-detail">{{ store.errors.join(" · ") }}</p>
    </div>

    <template v-else-if="store.state === 'ready'">
      <MetricTiles v-if="store.metrics" :metrics="store.metrics" />

      <div class="columns">
        <TransactionsTable
          v-if="store.transactions"
          :transactions="store.transactions"
        />
        <HealthPanel
          v-if="store.health"
          :health="store.health"
          :live-checks="store.liveChecks"
        />
      </div>

      <p v-if="store.errors.length > 0" role="alert" class="error">
        Some panels failed to load: {{ store.errors.join(" · ") }}
      </p>
    </template>

    <footer class="foot">
      <span>ZEROFAYYZ FINTECH · Portfolio Prototype · Vue 3 + Pinia client</span>
      <span>Sandbox data only · No real funds processed</span>
    </footer>
  </div>
</template>

<style scoped>
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

<style scoped>
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

/* Visible to everyone, not only to a screen reader: a limit nobody can see is
   a limit people discover by being refused. */
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
</style>
