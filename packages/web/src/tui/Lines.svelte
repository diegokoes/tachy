<script lang="ts">
  import { getChartGroup } from "./chartGroup.svelte";
  import { getPlot } from "./Plot.svelte";
  import { toneVar } from "./scale";
  import {
    areaPath,
    linePath,
    lineRuns,
    seriesPoints,
    visible,
    type Series,
  } from "./series";

  let {
    series,
    source,
    area = false,
    sweep = false,
  }: {
    series: Series[];
    /** Names this chart in its group: the pointer's owner is the one that shows points. */
    source: string;
    /** Fills under each line. */
    area?: boolean;
    /** The part of each line left of the pointer stays lit and the rest dims. */
    sweep?: boolean;
  } = $props();

  const plot = getPlot();
  const frame = $derived(plot.frame);
  const group = getChartGroup();

  const keys = $derived([
    ...new Set(series.flatMap((s) => s.points.map((p) => p.key))),
  ]);
  const shown = $derived(visible(series, group.hidden));
  const x = (key: string) => frame.bandAt(key) + frame.band / 2;
  const here = $derived(group.pointer.key);
  const clip = $props.id();
  const reach = $derived(here && keys.includes(here) ? x(here) : frame.iw);
  const mine = $derived(group.pointer.source === source);
</script>

{#if sweep}
  <defs>
    <clipPath id={clip}
      ><rect x={0} y={0} width={reach} height={frame.ih} /></clipPath
    >
  </defs>
{/if}

{#each shown as line (line.key)}
  {@const pts = seriesPoints(line, x, frame.at)}
  <g style="--tone-color: {toneVar(line.tone)}" class:swept={sweep}>
    {#if area}<path class="area" d={areaPath(pts, frame.ih)} />{/if}
    {#each lineRuns( line.points, (q) => [x(q.key), frame.at(q.value)] ) as run, runIndex (runIndex)}
      <path
        class="line"
        class:dashed={run.dashed}
        d={linePath(run.pts)}
        style={run.tone ? `stroke: ${toneVar(run.tone)}` : undefined}
      />
    {/each}
    {#if sweep}
      <g clip-path="url(#{clip})">
        {#if area}<path class="area lit" d={areaPath(pts, frame.ih)} />{/if}
        <path class="line lit" d={linePath(pts)} />
      </g>
    {/if}
    {#if mine && here}
      {@const point = line.points.find((q) => q.key === here)}
      {#if point}<circle
          class="dot"
          cx={x(point.key)}
          cy={frame.at(point.value)}
          r="3.5"
        />{/if}
    {/if}
  </g>
{/each}

{#if here && keys.includes(here)}
  <line class="rule" x1={x(here)} x2={x(here)} y1={0} y2={frame.ih} />
{/if}

{#each keys as key (key)}
  <rect
    class="hit"
    x={frame.bandAt(key) - (frame.step - frame.band) / 2}
    y={0}
    width={frame.step}
    height={frame.ih}
    role="presentation"
    onpointerenter={() => group.point(source, key)}
    onpointermove={() => group.point(source, key)}
    onpointerleave={() => group.leave(source)}
  />
{/each}

<style>
  .line {
    fill: none;
    stroke: var(--tone-color);
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .dashed {
    stroke-dasharray: 4 4;
  }
  .swept > .line,
  .swept > .area {
    opacity: 0.28;
  }
  .lit.line {
    stroke-width: 2;
  }
  .lit.area {
    fill: color-mix(in srgb, var(--tone-color) 30%, transparent);
  }
  .area {
    fill: color-mix(in srgb, var(--tone-color) 18%, transparent);
    stroke: none;
  }
  .dot {
    fill: var(--tone-color);
    stroke: var(--panel-solid);
    stroke-width: 1.5;
  }
  .rule {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    pointer-events: none;
  }
  .hit {
    fill: transparent;
  }
</style>
