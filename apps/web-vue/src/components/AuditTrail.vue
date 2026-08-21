<script setup lang="ts">
import { relative } from "../format";
import type { AuditLogs } from "../schemas";

defineProps<{ audit: AuditLogs }>();
defineEmits<{ refresh: [] }>();
</script>

<template>
  <section aria-label="Audit trail" class="trail">
    <header class="trail-header">
      <div>
        <h3>Audit trail</h3>
        <p class="source">
          Append-only records straight from PostgreSQL — a database trigger
          refuses UPDATE and DELETE, so what you did is what it says.
        </p>
      </div>
      <button type="button" class="refresh" @click="$emit('refresh')">
        Refresh
      </button>
    </header>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Action</th>
            <th scope="col">Actor</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in audit.data" :key="row.id">
            <td class="muted when">{{ relative(row.createdAt) }}</td>
            <td><code class="action">{{ row.action }}</code></td>
            <td class="muted">{{ row.actorEmail ?? "—" }}</td>
          </tr>
          <tr v-if="audit.data.length === 0">
            <td colspan="3" class="empty">No audit entries yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.trail-header {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}
h3 {
  color: rgba(255, 255, 255, 0.88);
  font-size: 13px;
  margin: 0;
}
.source {
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  line-height: 1.5;
  margin: 4px 0 0;
  max-width: 460px;
}
.refresh {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font-size: 11px;
  padding: 6px 14px;
  white-space: nowrap;
}
.refresh:hover {
  border-color: rgba(110, 231, 183, 0.4);
  color: #6ee7b7;
}
.scroll {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  margin-top: 12px;
  min-width: 480px;
  width: 100%;
}
th {
  color: rgba(255, 255, 255, 0.55);
  font-size: 10px;
  letter-spacing: 0.12em;
  padding: 8px 12px;
  text-align: left;
  text-transform: uppercase;
}
td {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 12px;
  padding: 10px 12px;
}
.when {
  white-space: nowrap;
}
.action {
  color: #6ee7b7;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.muted {
  color: rgba(255, 255, 255, 0.6);
}
.empty {
  color: rgba(255, 255, 255, 0.55);
  padding: 24px;
  text-align: center;
}
</style>
