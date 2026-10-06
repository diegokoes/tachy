<script lang="ts">
  import { getPlot } from "./Plot.svelte";
  import { toneVar } from "./scale";
  import { TIP_PAD, tooltipAt, tooltipSize, type TipLine } from "./tooltip";
  import type { Tone } from "./tone";

  let {
    at,
    title,
    lines,
  }: {
    /** Where the pointer is, in plot coordinates; null hides the tooltip. */
    at: { x: number; y: number } | null;
    title?: string;
    lines: (TipLine & { tone?: Tone })[];
  } = $props();

  const plot = getPlot();
  const f = $derived(plot.frame);
  const box = $derived(tooltipSize(title, lines, f.fs));
  const pos = $derived(at ? tooltipAt(at, box, { w: f.iw, h: f.ih }) : null);
  const lh = $derived(f.fs * 1.45);
  const top = $derived(TIP_PAD + f.fs);
</script>

{#if pos}
  <g class="tip" transform="translate({pos.x}, {pos.y})">
    <rect width={box.w} height={box.h} rx="3" />
    {#if title}
      <text class="head" x={TIP_PAD} y={top - f.fs * 0.2}>{title}</text>
    {/if}
    {#each lines as l, i (l.label)}
      {@const y = top + (i + (title ? 1 : 0)) * lh - f.fs * 0.2}
      {#if l.tone}
        <rect
          x={TIP_PAD}
          y={y - f.fs * 0.8}
          width={f.fs * 0.5}
          height={f.fs * 0.9}
          rx="1"
          style="fill: {toneVar(l.tone)}"
        />
      {/if}
      <text x={TIP_PAD + (l.tone ? f.fs * 0.8 : 0)} {y} class="lbl"
        >{l.label}</text
      >
      <text x={box.w - TIP_PAD} {y} class="val" text-anchor="end"
        >{l.value}</text
      >
    {/each}
  </g>
{/if}

<style>
  .tip {
    pointer-events: none;
  }
  .tip rect:first-child {
    fill: var(--panel-solid);
    stroke: var(--border);
  }
  text {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .head,
  .val {
    fill: var(--text);
  }
  .lbl {
    fill: var(--muted);
  }
</style>
