<script lang="ts">
  import { createChartGroup, setChartGroup } from "./chartGroup.svelte";
  import Axis from "./Axis.svelte";
  import Legend from "./Legend.svelte";
  import Lines from "./Lines.svelte";
  import Plot from "./Plot.svelte";
  import { seriesMax, visible, type Series } from "./series";
  import Tooltip from "./Tooltip.svelte";

  let {
    series,
    categories,
    labels,
    format = (n: number) => n.toLocaleString(),
    area = false,
    sweep = false,
    legend = true,
  }: {
    series: Series[];
    /** The bottom axis' categories, in order: days. */
    categories: string[];
    /** What each category is called on the axis and in the tooltip. */
    labels: (key: string) => string;
    format?: (n: number) => string;
    area?: boolean;
    sweep?: boolean;
    legend?: boolean;
  } = $props();

  const group = createChartGroup();
  setChartGroup(group);
  const source = "line-chart";

  const shown = $derived(visible(series, group.hidden));
  const top = $derived(seriesMax(shown));
  const here = $derived(group.pointer.key);
</script>

<div class="chart">
  <Plot {categories} max={Math.max(1, top)} {format}>
    {#snippet children(f)}
      {@const hit = here && categories.includes(here) ? here : null}
      <Axis side="left" grid format={(v) => format(Number(v))} />
      <Axis side="bottom" {categories} format={(k) => labels(String(k))} />
      <Lines {series} {source} {area} {sweep} />
      {#if hit}
        <Tooltip
          at={{ x: f.bandAt(hit) + f.band / 2, y: 0 }}
          title={labels(hit)}
          lines={shown.map((s) => ({
            label: s.label,
            value: format(s.points.find((p) => p.key === hit)?.value ?? 0),
            tone: s.tone,
          }))}
        />
      {/if}
    {/snippet}
  </Plot>
  {#if legend}
    <Legend
      items={series.map((s) => ({ key: s.key, label: s.label, tone: s.tone }))}
      hidden={group.hidden}
      ontoggle={(k) => group.toggle(k)}
    />
  {/if}
</div>

<style>
  .chart {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    width: 100%;
    height: 100%;
    min-height: 0;
  }
</style>
