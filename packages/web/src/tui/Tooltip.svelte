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
  const frame = $derived(plot.frame);
  const box = $derived(tooltipSize(title, lines, frame.fs));
  const pos = $derived(
    at ? tooltipAt(at, box, { w: frame.iw, h: frame.ih }) : null,
  );
  const lineHeight = $derived(frame.fs * 1.45);
  const top = $derived(TIP_PAD + frame.fs);
</script>

{#if pos}
  <g class="tip" transform="translate({pos.x}, {pos.y})">
    <rect width={box.w} height={box.h} rx="3" />
    {#if title}
      <text class="head" x={TIP_PAD} y={top - frame.fs * 0.2}>{title}</text>
    {/if}
    {#each lines as line, i (line.label)}
      {@const y = top + (i + (title ? 1 : 0)) * lineHeight - frame.fs * 0.2}
      {#if line.tone}
        <rect
          x={TIP_PAD}
          y={y - frame.fs * 0.8}
          width={frame.fs * 0.5}
          height={frame.fs * 0.9}
          rx="1"
          style="fill: {toneVar(line.tone)}"
        />
      {/if}
      <text x={TIP_PAD + (line.tone ? frame.fs * 0.8 : 0)} {y} class="lbl"
        >{line.label}</text
      >
      <text x={box.w - TIP_PAD} {y} class="val" text-anchor="end"
        >{line.value}</text
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
