<script lang="ts">
  import Axis from "./Axis.svelte";
  import Legend from "./Legend.svelte";
  import Plot from "./Plot.svelte";
  import { getView } from "./view";
  import type { Col, LegendItem } from "./marks";
  import { stackParts, toneVar } from "./scale";

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
    /** How a column's count is printed - compact, for figures in the millions. */
    format?: (n: number) => string;
    /** The stacked parts, named once under the plot. */
    legend?: LegendItem[];
  } = $props();

  // Capped rather than stretched: three categories across a full-width panel
  // would otherwise be three slabs, and a saturated fill that big reads as a
  // colour field rather than a measurement.
  const CAP_REM = 3.25;
  // Cut between stacked slices. The ground showing through is the separator: a
  // stroke around each would add ink that is not data.
  const CUT = 2;

  const peak = $derived(Math.max(0, ...rows.map((r) => r.value)));
  const top = $derived(
    max ?? Math.max(peak, ...rows.map((r) => r.behind ?? 0)),
  );
  const keys = $derived(rows.map((r) => r.key));
  const labels = $derived(new Map(rows.map((r) => [r.key, r.label])));

  // The axis carries the scale, so a number over every column would be saying
  // it twice. The peak and the latest still get one: those are the two a reader
  // looks for by name rather than off the axis.
  const view = getView();
  const dense = $derived(rows.length > (view.expanded ? 24 : 8));
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
    {#snippet children(frame)}
      {@const cap = Math.min(frame.band, CAP_REM * frame.rem)}
      <Axis side="left" grid format={(v) => format(Number(v))} />
      <Axis
        side="bottom"
        categories={keys}
        format={(k) => labels.get(String(k)) ?? String(k)}
      />

      {#each rows as row, i (row.key)}
        {@const edge = frame.bandAt(row.key) + (frame.band - cap) / 2}
        {@const inset = row.behind === undefined ? 0 : Math.min(4, cap / 4)}
        {@const x = edge + inset}
        {@const width = cap - inset * 2}
        {@const parts = stackParts(row.parts)}
        {@const n = count(row, i)}
        <g>
          <title
            >{row.title ?? row.label}: {row.text ?? format(row.value)}</title
          >
          {#if row.behind !== undefined}
            <rect
              class="behind"
              x={edge}
              y={frame.at(row.behind)}
              width={cap}
              height={Math.max(1, frame.up(row.behind))}
              rx="2"
            />
          {/if}
          {#if parts.length}
            {#each parts as part (part.key)}
              <rect
                {x}
                y={frame.at(part.offset + part.size)}
                {width}
                height={Math.max(1, frame.up(part.size) - CUT)}
                rx="2"
                style="fill: {toneVar(part.tone)}"
              />
            {/each}
          {:else}
            <rect
              {x}
              y={frame.at(row.value)}
              {width}
              height={Math.max(1, frame.up(row.value))}
              rx="2"
              style="fill: {toneVar(row.tone)}"
            />
          {/if}
          {#each stackParts(row.inner) as part (part.key)}
            {@const w = Math.max(3, Math.round(width * 0.4))}
            <rect
              class="inner"
              x={x + (width - w) / 2}
              y={frame.at(part.offset + part.size)}
              width={w}
              height={Math.max(3, frame.up(part.size))}
              rx="1"
              style="fill: {toneVar(part.tone)}"
            />
          {/each}
          {#if n}
            <text
              class="n"
              x={edge + cap / 2}
              y={frame.at(row.value) - frame.fs * 0.45}
              text-anchor="middle">{n}</text
            >
          {/if}
        </g>
      {/each}
    {/snippet}
  </Plot>

  {#if legend?.length}<Legend items={legend} />{/if}
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
    position: relative;
    height: 100%;
    min-height: 0;
  }
  /* Hung below the tile rather than taken out of it, so the axis lines up
     with a neighbour that has no legend. The grid gap has room for it. */
  .chart.fill > :global(.legend) {
    position: absolute;
    top: calc(100% + var(--pad-2));
    left: 0;
    right: 0;
  }

  .inner {
    stroke: var(--panel-solid);
    stroke-width: 1.5;
  }
  .behind {
    fill: color-mix(in srgb, var(--muted) 22%, transparent);
  }

  .n {
    fill: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
</style>
