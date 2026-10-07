<script lang="ts">
  import { getPlot } from "./Plot.svelte";

  let {
    categories,
    active = null,
    onhover,
  }: {
    categories: string[];
    /** The category under the pointer; the band behind it is shaded. */
    active?: string | null;
    onhover?: (key: string | null) => void;
  } = $props();

  const plot = getPlot();
  const frame = $derived(plot.frame);
  const slot = (k: string) => frame.bandAt(k) - (frame.step - frame.band) / 2;
</script>

{#if active && categories.includes(active)}
  <rect
    class="band"
    x={slot(active)}
    y={0}
    width={frame.step}
    height={frame.ih}
  />
{/if}
{#each categories as category (category)}
  <rect
    class="hit"
    x={slot(category)}
    y={0}
    width={frame.step}
    height={frame.ih}
    role="presentation"
    onpointerenter={() => onhover?.(category)}
    onpointermove={() => onhover?.(category)}
    onpointerleave={() => onhover?.(null)}
  />
{/each}

<style>
  .band {
    fill: color-mix(in srgb, var(--muted) 14%, transparent);
    pointer-events: none;
  }
  .hit {
    fill: transparent;
  }
</style>
