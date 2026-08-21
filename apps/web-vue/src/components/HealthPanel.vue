<script setup lang="ts">
import { computed } from "vue";

import type { Health } from "../schemas";

const props = defineProps<{ health: Health; liveChecks: number }>();

const rows = computed(() => {
  const { database, stripe, webhook } = props.health.checks;

  return [
    {
      label: "API service",
      detail: `v${props.health.version}`,
      healthy: props.health.status === "operational",
    },
    {
      label: "PostgreSQL",
      detail: database.latencyMs === null ? "Unavailable" : `${database.latencyMs} ms`,
      healthy: database.status === "operational",
    },
    {
      label: "Stripe sandbox",
      detail: stripe.status === "configured" ? "Test API access" : "Awaiting test key",
      healthy: stripe.status === "configured",
    },
    {
      label: "Webhook queue",
      detail:
        webhook.status === "configured"
          ? "Signature verification"
          : "Awaiting signing secret",
      healthy: webhook.status === "configured",
    },
  ];
});
</script>

<template>
  <section aria-label="System health" class="panel">
    <header class="panel-header">
      <h2>System health</h2>
      <span class="badge">{{ liveChecks }} of 4 live</span>
    </header>
    <ul class="checks">
      <li v-for="row in rows" :key="row.label" class="check">
        <span class="dot" :class="{ healthy: row.healthy }" aria-hidden="true" />
        <div>
          <p class="check-label">{{ row.label }}</p>
          <p class="check-detail">{{ row.detail }}</p>
        </div>
        <span class="check-status">{{ row.healthy ? "Live" : "Down" }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.panel {
  background: rgba(13, 26, 23, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 20px;
}
.panel-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}
.panel-header h2 {
  color: rgba(255, 255, 255, 0.88);
  font-size: 14px;
  margin: 0;
}
.badge {
  background: rgba(110, 231, 183, 0.1);
  border: 1px solid rgba(110, 231, 183, 0.2);
  border-radius: 999px;
  color: #6ee7b7;
  font-size: 10px;
  padding: 4px 10px;
  text-transform: uppercase;
}
.checks {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
}
.check {
  align-items: center;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  gap: 12px;
  padding: 12px 0;
}
.dot {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  height: 8px;
  width: 8px;
}
.dot.healthy {
  background: #6ee7b7;
  box-shadow: 0 0 8px rgba(110, 231, 183, 0.6);
}
.check-label {
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  margin: 0;
}
.check-detail {
  color: rgba(255, 255, 255, 0.55);
  font-size: 10px;
  margin: 2px 0 0;
}
.check-status {
  color: rgba(110, 231, 183, 0.7);
  font-size: 10px;
  margin-left: auto;
}
</style>
