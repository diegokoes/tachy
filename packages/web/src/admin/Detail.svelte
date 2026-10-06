<script lang="ts">
  import type { Snippet } from "svelte";
  import Counts from "./Counts.svelte";
  import type { Count } from "./overview";
  import { PERIODS, period, setPeriod } from "./period.svelte";

  let {
    figures,
    windowed = false,
    days,
    loading = false,
    table,
    children,
  }: {
    /** What the chart adds up to, said once above it. */
    figures: Count[];
    /** The data behind it takes a window, so the switch is shown. */
    windowed?: boolean;
    /** The window the data covers now, for the switch to mark. */
    days?: number;
    loading?: boolean;
    /** The rows behind the chart. */
    table?: Snippet;
    children: Snippet;
  } = $props();

  const now = $derived(period.days ?? days);
</script>

<div class="detail">
  <div class="head">
    <Counts items={figures} {loading} />
    {#if windowed}
      <div class="period" role="group" aria-label="period">
        {#each PERIODS as d (d)}
          <button
            type="button"
            class:on={now === d}
            aria-pressed={now === d}
            onclick={() => setPeriod(d)}>{d} d</button
          >
        {/each}
      </div>
    {/if}
  </div>
  <div class="chart">{@render children()}</div>
  {#if table}<div class="rows">{@render table()}</div>{/if}
</div>

<style>
  .detail {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--pad-4);
  }
  .head > :global(.counts) {
    flex: 1 1 auto;
    min-width: 0;
  }
  .period {
    flex: none;
    display: inline-flex;
    gap: var(--pad-1);
  }
  .period button {
    padding: var(--pad-1) var(--pad-3);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--muted);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .period button:hover,
  .period button:focus-visible {
    background: color-mix(in srgb, var(--muted) 12%, transparent);
    color: var(--text);
  }
  .period button.on {
    color: var(--text);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  /* The chart is a size container like a tile's body, so a plot fills it. */
  .chart {
    flex: 5 1 0;
    min-height: 12rem;
    display: flex;
    flex-direction: column;
    container-type: size;
  }
  .rows {
    flex: 4 1 0;
    min-height: 8rem;
    overflow: auto;
  }
</style>
