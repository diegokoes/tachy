<script lang="ts">
  import { getPlot } from "./Plot.svelte";

  let {
    at,
    value,
  }: {
    /** A category: draws a vertical guide through it. */
    at?: string;
    /** A value: draws a horizontal guide at it. */
    value?: number;
  } = $props();

  const plot = getPlot();
  const f = $derived(plot.frame);
  const x = $derived(at === undefined ? null : f.bandAt(at) + f.band / 2);
  const y = $derived(value === undefined ? null : f.at(value));
</script>

{#if x !== null}<line class="guide" x1={x} x2={x} y1={0} y2={f.ih} />{/if}
{#if y !== null}<line class="guide" x1={0} x2={f.iw} y1={y} y2={y} />{/if}

<style>
  .guide {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 4 4;
    opacity: 0.5;
    pointer-events: none;
  }
</style>
