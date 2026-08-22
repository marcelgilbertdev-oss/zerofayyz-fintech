<script lang="ts">
  import type { FullAutoFill } from "svelte/elements";

  let { id, autocomplete = "current-password", value = $bindable() }: {
    id: string;
    autocomplete?: FullAutoFill;
    value: string;
  } = $props();

  let visible = $state(false);
</script>

<div class="field">
  {#if visible}
    <input {id} bind:value type="text" {autocomplete} required />
  {:else}
    <input {id} bind:value type="password" {autocomplete} required />
  {/if}
  <!-- aria-pressed rather than a swapping label: a screen reader hears one
       stable control ("Show password, toggle button, pressed") instead of a
       button that appears to be replaced mid-interaction. -->
  <button
    type="button"
    class="reveal"
    aria-pressed={visible}
    aria-label="Show password"
    onclick={() => (visible = !visible)}
  >
    {#if visible}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2.8" />
        <path d="M4 4l16 16" />
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2.8" />
      </svg>
    {/if}
  </button>
</div>

<style>
  .field {
    position: relative;
  }
  input {
    /* Without this the 14px + 40px horizontal padding is added ON TOP of width:100%,
       so the field overflows its grid column and slides under the card beside it.
       Found in a live charter run on the deployed Vue client. */
    box-sizing: border-box;
    background: #16241f;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: #fff;
    font-size: 13px;
    padding: 10px 40px 10px 14px;
    width: 100%;
  }
  input:focus {
    border-color: rgba(110, 231, 183, 0.4);
    outline: none;
  }
  .reveal {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    height: 20px;
    padding: 0;
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
  }
  .reveal:hover {
    color: rgba(255, 255, 255, 0.85);
  }
  .reveal svg {
    height: 100%;
    width: 100%;
  }
</style>
