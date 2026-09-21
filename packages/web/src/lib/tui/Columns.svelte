<script lang="ts">
  import Axis from "./Axis.svelte";
  import Plot from "./Plot.svelte";
  import type { Col } from "./marks";
  import { stackParts, toneVar } from "./scale";
  import type { Tone } from "./tone";

  let {
    rows,
    max,
    height = "7rem",
    fill = false,
    format = (n: number) => n.toLocaleString(),
    legend,
  }: {
    rows: Col[];
    /** Shared scale. Defaults to the largest row, so the tallest is always full. */
    max?: number;
    height?: string;
    /** Take the parent's whole height instead of `height`. */
    fill?: boolean;
    /** How a column's count is printed — compact, for figures in the millions. */
    format?: (n: number) => string;
    /** The stacked parts, named once under the plot. */
    legend?: { key: string; label: string; tone: Tone }[];
  } = $props();

  /* Capped rather than stretched: three categories across a full-width panel
     would otherwise be three slabs, and a saturated fill that big reads as a
     colour field rather than a measurement. */
  const CAP_REM = 3.25;
  /* Cut between stacked slices. The ground showing through is the separator:
     a stroke around each would add ink that is not data. */
  const CUT = 2;

  const peak = $derived(Math.max(0, ...rows.map((r) => r.value)));
  const top = $derived(max ?? peak);
  const keys = $derived(rows.map((r) => r.key));
  const labels = $derived(new Map(rows.map((r) => [r.key, r.label])));

  /* The axis carries the scale, so a number over every column would be
     saying it twice. The peak and the latest still get one: those are the two
     a reader looks for by name rather than off the axis. */
  const dense = $derived(rows.length > 8);
  const count = (r: Col, i: number) =>
    r.text ??
    (r.value && (!dense || i === rows.length - 1 || r.value === peak)
      ? format(r.value)
      : null);
</script>

<div class="chart" class:fill>
  <Plot
    categories={keys}
    max={top}
    {format}
    height={fill ? undefined : height}
    padding={dense ? 0.16 : 0.34}
  >
    {#snippet children(f)}
      {@const cap = Math.min(f.band, CAP_REM * f.rem)}
      <Axis side="left" grid format={(v) => format(Number(v))} />
      <Axis
        side="bottom"
        categories={keys}
        format={(k) => labels.get(String(k)) ?? String(k)}
      />

      {#each rows as r, i (r.key)}
        {@const x = f.bandAt(r.key) + (f.band - cap) / 2}
        {@const parts = stackParts(r.parts)}
        {@const n = count(r, i)}
        <g>
          <title>{r.title ?? r.label}: {r.text ?? format(r.value)}</title>
          {#if parts.length}
            {#each parts as p (p.key)}
              <rect
                {x}
                y={f.at(p.offset + p.size)}
                width={cap}
                height={Math.max(1, f.up(p.size) - CUT)}
                rx="2"
                style="fill: {toneVar(p.tone)}"
              />
            {/each}
          {:else}
            <rect
              {x}
              y={f.at(r.value)}
              width={cap}
              height={Math.max(1, f.up(r.value))}
              rx="2"
              style="fill: {toneVar(r.tone)}"
            />
          {/if}
          {#if n}
            <text
              class="n"
              x={x + cap / 2}
              y={f.at(r.value) - f.fs * 0.45}
              text-anchor="middle">{n}</text
            >
          {/if}
        </g>
      {/each}
    {/snippet}
  </Plot>

  {#if legend?.length}
    <div class="legend">
      {#each legend as l (l.key)}
        <span class="key" style="--tone-color: {toneVar(l.tone)}"
          >{l.label}</span
        >
      {/each}
    </div>
  {/if}
</div>

<style>
  .chart {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    width: 100%;
    min-width: 0;
  }
  .chart.fill {
    height: 100%;
    min-height: 0;
  }

  .n {
    fill: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 var(--pad-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .key::before {
    content: "";
    display: inline-block;
    width: 0.42em;
    height: 0.85em;
    margin-right: var(--pad-1);
    vertical-align: middle;
    border-radius: 1px;
    background: var(--tone-color);
  }
</style>
