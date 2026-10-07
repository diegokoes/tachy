<script lang="ts">
  import { measureBox, typeSize } from "./fit";
  import {
    radarAnchor,
    radarMax,
    radarPath,
    radarPoint,
    radarRing,
    radarTicks,
  } from "./radar";
  import { CH_EM, toneVar } from "./scale";
  import type { Tone } from "./tone";

  export type RadarAxis = { key: string; label: string; tone?: Tone };
  export type RadarSeries = {
    key: string;
    label: string;
    tone: Tone;
    /** One value per axis, in the order of `axes`. */
    values: number[];
  };

  let {
    axes,
    series,
    format = (n: number) => n.toLocaleString(),
    rings = 3,
  }: {
    axes: RadarAxis[];
    series: RadarSeries[];
    format?: (n: number) => string;
    rings?: number;
  } = $props();

  let w = $state(0);
  let h = $state(0);

  const type = $derived.by(() => {
    void w;
    return typeSize();
  });
  const fs = $derived(type.fs);

  const n = $derived(axes.length);
  const max = $derived(radarMax(series.flatMap((s) => s.values)));
  const grid = $derived(radarTicks(max, rings));
  const shown = (s: string) => (s.length > 11 ? `${s.slice(0, 10)}…` : s);
  const labelW = $derived(
    Math.ceil(
      Math.max(0, ...axes.map((a) => shown(a.label).length)) * CH_EM * fs,
    ) + 8,
  );
  const radius = $derived(
    Math.max(0, Math.min(w / 2 - labelW - fs * 1.6, h / 2 - fs * 2.8)),
  );
  const lone = $derived(series.length === 1);
</script>

<!--
@component
One spoke per category and a ring per round number: the shape says where the
weight is, and every spoke carries its own figure so nothing has to be read off
the grid.
-->
<div
  class="radar"
  use:measureBox={(nw, nh) => {
    w = nw;
    h = nh;
  }}
>
  {#if w > 0 && h > 0 && n >= 3 && radius > 0}
    <svg viewBox="0 0 {w} {h}" role="img" aria-label="radar of {n} values">
      <g transform="translate({w / 2}, {h / 2})">
        {#each grid as ring (ring)}
          <path class="ring" d={radarRing(n, (ring / max) * radius)} />
        {/each}
        {#each axes as axis, i (axis.key)}
          {@const tip = radarPoint(i, n, radius)}
          <line class="spoke" x1="0" y1="0" x2={tip.x} y2={tip.y} />
        {/each}

        {#each series as line (line.key)}
          <g style="--tone-color: {toneVar(line.tone)}">
            <path class="area" d={radarPath(line.values, max, radius)} />
            {#each line.values as value, i (axes[i].key)}
              {@const point = radarPoint(i, n, (value / (max || 1)) * radius)}
              <circle
                class="dot"
                cx={point.x}
                cy={point.y}
                r="3.2"
                style={lone && axes[i].tone
                  ? `fill: ${toneVar(axes[i].tone)}`
                  : undefined}
              >
                <title>{axes[i].label}: {format(value)}</title>
              </circle>
            {/each}
          </g>
        {/each}

        {#each axes as axis, i (axis.key)}
          {@const end = radarPoint(i, n, radius + fs * 0.9)}
          {@const anchor = radarAnchor(i, n)}
          <text
            class="lbl"
            x={end.x}
            y={end.y - (lone && end.y < -radius * 0.9 ? fs * 1.2 : 0)}
            text-anchor={anchor}
            dominant-baseline={end.y < -radius * 0.9
              ? "auto"
              : end.y > radius * 0.9
                ? "hanging"
                : "middle"}
          >
            {shown(axis.label)}
            {#if lone}
              <tspan class="val" x={end.x} dy={fs * 1.15}
                >{format(series[0].values[i])}</tspan
              >
            {/if}
          </text>
        {/each}
      </g>
    </svg>
  {/if}
</div>

<style>
  .radar {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    overflow: hidden;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .ring,
  .spoke {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1;
    opacity: 0.25;
  }
  .area {
    fill: color-mix(in srgb, var(--tone-color) 22%, transparent);
    stroke: var(--tone-color);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .dot {
    fill: var(--tone-color);
    stroke: var(--panel-solid);
    stroke-width: 1.5;
  }
  text {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .lbl {
    fill: var(--muted);
  }
  .val {
    fill: var(--text);
  }
</style>
