<script lang="ts">
  import { getPlot } from "./Plot.svelte";
  import { keySpan } from "./series";

  let {
    categories,
    from,
    to,
    title,
  }: {
    /** The plot's categories, in drawing order, to find the span in. */
    categories: string[];
    from: string;
    to: string;
    /** What the span was, on hover. */
    title?: string;
  } = $props();

  const plot = getPlot();
  const f = $derived(plot.frame);
  const id = $props.id();
  const span = $derived(keySpan(categories, from, to));
  const x = $derived(
    span ? f.bandAt(categories[span[0]]) - (f.step - f.band) / 2 : 0,
  );
  const w = $derived(span ? (span[1] - span[0] + 1) * f.step : 0);
</script>

{#if span}
  <defs>
    <pattern
      {id}
      width="8"
      height="8"
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(-45)"
    >
      <line x1="0" y1="0" x2="0" y2="8" />
    </pattern>
  </defs>
  <rect {x} y={0} width={w} height={f.ih} fill="url(#{id})">
    {#if title}<title>{title}</title>{/if}
  </rect>
{/if}

<style>
  pattern line {
    stroke: var(--muted);
    stroke-width: 2;
    opacity: 0.2;
  }
</style>
