<script lang="ts">
  import { money } from "./format";
  import type { Metrics } from "./schemas";

  const { metrics }: { metrics: Metrics } = $props();

  const tiles = $derived([
    {
      label: "Gross volume",
      value: money(metrics.grossVolumeMinor, metrics.currency),
      note: `${metrics.succeededCount} succeeded`,
    },
    {
      label: "Successful payments",
      value: String(metrics.succeededCount),
      note:
        metrics.successRate === null
          ? "No settled payments yet"
          : `${metrics.successRate}% success rate`,
    },
    {
      label: "Pending settlement",
      value: money(metrics.pending.amountMinor, metrics.currency),
      note: `${metrics.pending.count} processing`,
    },
    {
      label: "Webhook events",
      value: String(metrics.eventsRecorded),
      note: "Deduplicated by Stripe event id",
    },
  ]);
</script>

<section aria-label="Key metrics" class="tiles">
  {#each tiles as tile (tile.label)}
    <article class="tile">
      <p class="tile-label">{tile.label}</p>
      <p class="tile-value">{tile.value}</p>
      <p class="tile-note">{tile.note}</p>
    </article>
  {/each}
</section>

<style>
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
    letter-spacing: -0.03em;
    margin: 10px 0 0;
  }
  .tile-note {
    color: rgba(110, 231, 183, 0.75);
    font-size: 12px;
    margin: 12px 0 0;
  }
</style>
