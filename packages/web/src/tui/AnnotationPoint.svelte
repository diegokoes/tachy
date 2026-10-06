<script lang="ts">
  import { getPlot } from "./Plot.svelte";
  import { toneVar } from "./scale";
  import type { Tone } from "./tone";

  let {
    at,
    value,
    label,
    details,
    r = 8,
    tone = "info",
    onhover,
  }: {
    at: string;
    value: number;
    /** A letter or a number inside the marker. */
    label: string;
    /** What the marker stands for, on hover. */
    details?: string;
    r?: number;
    tone?: Tone;
    onhover?: (on: boolean) => void;
  } = $props();

  const plot = getPlot();
  const f = $derived(plot.frame);
  const cx = $derived(f.bandAt(at) + f.band / 2);
</script>

<g
  class="point"
  role="img"
  aria-label={details ?? label}
  onpointerenter={() => onhover?.(true)}
  onpointerleave={() => onhover?.(false)}
>
  {#if details}<title>{details}</title>{/if}
  <circle {cx} cy={f.at(value)} {r} style="fill: {toneVar(tone)}" />
  <text x={cx} y={f.at(value)} dominant-baseline="central" text-anchor="middle"
    >{label}</text
  >
</g>

<style>
  .point {
    cursor: default;
  }
  text {
    fill: var(--panel-solid);
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 700;
    pointer-events: none;
  }
</style>
