<script lang="ts">
  import { money, relative } from "./format";
  import type { Transactions } from "./schemas";

  const { transactions }: { transactions: Transactions } = $props();
</script>

<section aria-label="Recent transactions" class="panel">
  <header>
    <h2>Recent transactions</h2>
    <p class="source">Live sandbox records from PostgreSQL</p>
  </header>
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th scope="col">Customer</th>
          <th scope="col">Amount</th>
          <th scope="col">Method</th>
          <th scope="col">Status</th>
          <th scope="col" class="right">Time</th>
        </tr>
      </thead>
      <tbody>
        {#each transactions.data as row (row.id)}
          <tr>
            <td>
              <p class="name">{row.customer.displayName}</p>
              <p class="email">{row.customer.email}</p>
            </td>
            <td class="amount">{money(row.amountMinor, row.currency)}</td>
            <td class="muted">{row.methodLabel}</td>
            <td><span class="status" data-status={row.status}>{row.status}</span></td>
            <td class="muted right">{relative(row.createdAt)}</td>
          </tr>
        {/each}
        {#if transactions.data.length === 0}
          <tr><td colspan="5" class="empty">No transactions yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</section>

<style>
  .panel {
    background: rgba(13, 26, 23, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 20px;
  }
  h2 {
    color: rgba(255, 255, 255, 0.88);
    font-size: 14px;
    margin: 0;
  }
  .source {
    color: rgba(255, 255, 255, 0.55);
    font-size: 11px;
    margin: 4px 0 0;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    margin-top: 12px;
    min-width: 640px;
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
    padding: 12px;
  }
  .name {
    color: rgba(255, 255, 255, 0.8);
    margin: 0;
  }
  .email {
    color: rgba(255, 255, 255, 0.55);
    font-size: 10px;
    margin: 2px 0 0;
  }
  .amount {
    color: rgba(255, 255, 255, 0.85);
    font-weight: 600;
  }
  .muted {
    color: rgba(255, 255, 255, 0.6);
  }
  .right {
    text-align: right;
  }
  .status {
    border: 1px solid rgba(251, 191, 36, 0.25);
    border-radius: 999px;
    color: #fcd34d;
    font-size: 11px;
    padding: 3px 10px;
    text-transform: capitalize;
  }
  .status[data-status="succeeded"] {
    border-color: rgba(110, 231, 183, 0.25);
    color: #6ee7b7;
  }
  .status[data-status="processing"] {
    border-color: rgba(125, 211, 252, 0.25);
    color: #7dd3fc;
  }
  .empty {
    color: rgba(255, 255, 255, 0.55);
    padding: 32px;
    text-align: center;
  }
</style>
