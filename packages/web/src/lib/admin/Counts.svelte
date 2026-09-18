<script lang="ts">
  import { RAMP } from "../tui";
  import { activeSpy } from "../sections/spy.svelte";
  import Figure from "./Figure.svelte";

  export type Count = {
    key: string;
    label: string;
    value: number;
    /** A second fact about the same figure — "24 top level", "18 units". */
    detail?: string;
    tone?: "accent" | "ok" | "warn" | "danger" | "muted";
    /** The section on this page this figure is the count of. */
    to?: string;
  };

  let {
    items,
    loading = false,
  }: {
    items: Count[];
    loading?: boolean;
  } = $props();
</script>

{#snippet body(it: Count)}
  {#if loading}
    <span class="skeleton" aria-label="loading">{RAMP[0].repeat(6)}</span>
  {:else}
    <Figure value={it.value} tone={it.tone} />
  {/if}
  <span class="lbl">{it.label}</span>
  {#if it.detail}<span class="detail">{it.detail}</span>{/if}
{/snippet}

<div class="counts">
  {#each items as it (it.key)}
    {#if it.to}
      {@const to = it.to}
      <button class="cell go" title="go to {to}" onclick={() => activeSpy()?.goto(to)}>
        {@render body(it)}
      </button>
    {:else}
      <div class="cell">{@render body(it)}</div>
    {/if}
  {/each}
</div>

<style>
  .counts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: var(--pad-3) var(--pad-4);
    width: 100%;
    min-width: 0;
  }

  .cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    min-width: 0;
    padding: var(--pad-1) var(--pad-2);
    margin-left: calc(var(--pad-2) * -1);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  .cell.go {
    cursor: pointer;
  }
  .cell.go:hover,
  .cell.go:focus-visible {
    background: color-mix(in srgb, var(--muted) 12%, transparent);
  }

  .lbl {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .detail {
    font-size: var(--fs-xs);
    color: var(--muted);
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .skeleton {
    font-family: var(--font-mono);
    font-size: var(--fs-fig);
    line-height: 1.1;
    color: var(--border);
    letter-spacing: 0.1em;
    user-select: none;
  }
</style>
