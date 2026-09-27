<script lang="ts">
  import { getPlot } from "./Plot.svelte";
  import { labelStride, TICK_LEN } from "./scale";

  let {
    side = "left",
    format = (v: string | number) => String(v),
    grid = false,
    /** Bottom axis only: the bands to label, in drawing order. */
    categories = [],
  }: {
    side?: "left" | "bottom";
    format?: (v: string | number) => string;
    /** Rules across the plot at each value tick. Left axis only. */
    grid?: boolean;
    categories?: string[];
  } = $props();

  const plot = getPlot();
  const f = $derived(plot.frame);

  /* A day-of-month label is the widest thing the bottom axis carries, and two
     of them touching is what makes a 14-column chart unreadable. */
  const stride = $derived(
    labelStride(categories.length, f.iw, f.fs * 2.2),
  );
</script>

{#if side === "left"}
  <g class="axis" aria-hidden="true">
    {#each f.ticks as t (t)}
      {@const y = f.at(t)}
      {#if grid}
        <line class="grid" x1={0} x2={f.iw} y1={y} y2={y} />
      {/if}
      <line class="tick" x1={-TICK_LEN} x2={0} y1={y} y2={y} />
      <text class="lbl" x={-TICK_LEN - 4} y={y} dominant-baseline="middle" text-anchor="end"
        >{format(t)}</text
      >
    {/each}
    <line class="rule" x1={0} x2={0} y1={0} y2={f.ih} />
  </g>
{:else}
  <g class="axis" aria-hidden="true">
    <line class="rule" x1={0} x2={f.iw} y1={f.ih} y2={f.ih} />
    {#each categories as key, i (key)}
      {@const x = f.bandAt(key) + f.band / 2}
      {#if i % stride === 0}
        <text class="lbl" {x} y={f.ih + TICK_LEN + f.fs * 0.9} text-anchor="middle"
          >{format(key)}</text
        >
      {/if}
    {/each}
  </g>
{/if}

<style>
  /* Presentation attributes cannot read a custom property, so every colour
     here is set in CSS and inherited down. */
  .rule,
  .tick {
    stroke: var(--border);
    stroke-width: 1;
  }
  /* Fainter than the rule: a gridline is a reading aid, not an edge. */
  .grid {
    stroke: color-mix(in srgb, var(--border) 65%, transparent);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .lbl {
    fill: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
</style>
