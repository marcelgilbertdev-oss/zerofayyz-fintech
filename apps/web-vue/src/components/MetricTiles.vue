<script setup lang="ts">
import { computed } from "vue";

import { money } from "../format";
import type { Metrics } from "../schemas";

const props = defineProps<{ metrics: Metrics }>();

const tiles = computed(() => [
  {
    label: "Gross volume",
    value: money(props.metrics.grossVolumeMinor, props.metrics.currency),
    note: `${props.metrics.succeededCount} succeeded`,
  },
  {
    label: "Successful payments",
    value: String(props.metrics.succeededCount),
    note:
      props.metrics.successRate === null
        ? "No settled payments yet"
        : `${props.metrics.successRate}% success rate`,
  },
  {
    label: "Pending settlement",
    value: money(props.metrics.pending.amountMinor, props.metrics.currency),
    note: `${props.metrics.pending.count} processing`,
  },
  {
    label: "Webhook events",
    value: String(props.metrics.eventsRecorded),
    note: "Deduplicated by Stripe event id",
  },
]);
</script>

<template>
  <section aria-label="Key metrics" class="tiles">
    <article v-for="tile in tiles" :key="tile.label" class="tile">
      <p class="tile-label">{{ tile.label }}</p>
      <p class="tile-value">{{ tile.value }}</p>
      <p class="tile-note">{{ tile.note }}</p>
    </article>
  </section>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.tile {
  background: rgba(13, 26, 23, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 20px;
}
.tile-label {
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  margin: 0;
}
.tile-value {
  color: #fff;
  font-size: 24px;
  font-weight: 600;
  margin: 10px 0 0;
  letter-spacing: -0.03em;
}
.tile-note {
  color: rgba(110, 231, 183, 0.75);
  font-size: 12px;
  margin: 12px 0 0;
}
</style>
