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
  const f = $derived(plot.frame);
  const slot = (k: string) => f.bandAt(k) - (f.step - f.band) / 2;
</script>

{#if active && categories.includes(active)}
  <rect class="band" x={slot(active)} y={0} width={f.step} height={f.ih} />
{/if}
{#each categories as k (k)}
  <rect
    class="hit"
    x={slot(k)}
    y={0}
    width={f.step}
    height={f.ih}
    role="presentation"
    onpointerenter={() => onhover?.(k)}
    onpointermove={() => onhover?.(k)}
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
