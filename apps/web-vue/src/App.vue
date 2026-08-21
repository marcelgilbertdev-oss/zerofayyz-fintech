<script setup lang="ts">
import { onMounted } from "vue";

import HealthPanel from "./components/HealthPanel.vue";
import MetricTiles from "./components/MetricTiles.vue";
import TransactionsTable from "./components/TransactionsTable.vue";
import { useDashboardStore } from "./stores/dashboard";

const store = useDashboardStore();

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
      <button
        type="button"
        class="pay"
        :disabled="store.checkoutPending"
        @click="store.checkout()"
      >
        {{ store.checkoutPending ? "Opening Stripe…" : "+ Test payment" }}
      </button>
    </header>

    <p v-if="store.checkoutError" role="alert" class="error">
      {{ store.checkoutError }}
    </p>

    <p v-if="store.state === 'loading'" class="loading" role="status">
      Loading live data…
    </p>

    <p v-else-if="store.state === 'error'" role="alert" class="error">
      The API is unreachable. {{ store.errors.join(" · ") }}
    </p>

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
.foot {
  color: rgba(255, 255, 255, 0.55);
  display: flex;
  font-size: 10px;
  justify-content: space-between;
  margin-top: 12px;
}
</style>
