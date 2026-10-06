<script lang="ts">
  import { onMount } from "svelte";
  import { fmtDate } from "../dates.svelte";
  import {
    Bars,
    DataTable,
    Legend,
    LineChart,
    Radar,
    Units,
    compact,
    dayOfMonth,
    type Bar,
    type Col,
    type Column,
    type Series,
  } from "../tui";
  import type { Freshness } from "@tachy/contract";
  import { census } from "../admin/census.svelte";
  import { activity } from "../admin/activity.svelte";
  import { pct, type Count } from "../admin/overview";
  import Detail from "../admin/Detail.svelte";
  import { ago, col, seriesStats, signed, TILE_DAYS } from "../admin/detail";
  import { band, FRESHNESS_STATES, freshnessGroups } from "./freshness";
  import { freshness } from "./freshness.svelte";
  import Overview from "../admin/Overview.svelte";
  import Tile from "../admin/Tile.svelte";

  const d = $derived(census.data.detail.sources);

  onMount(() => void freshness.reload());
  const r = $derived(census.data.detail.repos);
  const traffic = $derived(activity.data.traffic);

  /* Whose traffic it is - the agent reading on someone's behalf, sync, or the
     app itself - is what a request-rate scrape cannot tell you. */
  const ORIGINS = [
    { key: "agent", label: "agent", tone: "accent" },
    { key: "sync", label: "sync", tone: "info" },
    { key: "app", label: "app", tone: "muted" },
  ] as const;

  const split = (x: { agent: number; sync: number; app: number }) =>
    ORIGINS.map((o) => ({ key: o.key, value: x[o.key], tone: o.tone }));

  const REFUSALS = [
    { key: "rate_limited", label: "rate limited", tone: "warn" },
    { key: "auth_failures", label: "auth refused", tone: "danger" },
  ] as const;

  const perDay = $derived(
    traffic.per_day.map((x): Col => ({
      key: x.day,
      label: dayOfMonth(x.day),
      title: `${fmtDate(x.day)}: ${x.agent + x.sync + x.app} calls, ${x.rate_limited} rate limited, ${x.auth_failures} refused`,
      value: x.agent + x.sync + x.app,
      parts: split(x),
    })),
  );
  const callSeries = (days: typeof traffic.per_day): Series[] =>
    ORIGINS.map((o) => ({
      key: o.key,
      label: o.label,
      tone: o.tone,
      points: days.map((d) => ({ key: d.day, value: d[o.key] })),
    }));
  const tilePerDay = $derived(perDay.slice(-TILE_DAYS));
  const calls = $derived(tilePerDay.reduce((n, c) => n + c.value, 0));

  const bySource = $derived(
    traffic.connections
      .map((c): Bar => ({
        key: c.slug,
        label: c.slug,
        value: c.agent + c.sync + c.app,
        parts: split(c),
      }))
      .sort((a, b) => b.value - a.value),
  );

  const connectionTotal = (c: { agent: number; sync: number; app: number }) =>
    c.agent + c.sync + c.app;
  const rateLimited = $derived(
    traffic.connections.reduce((n, c) => n + c.rate_limited, 0),
  );
  const authFailures = $derived(
    traffic.connections.reduce((n, c) => n + c.auth_failures, 0),
  );

  const stale = $derived(
    freshness.data.filter((f) => ["older", "never"].includes(band(f.last_at))),
  );
  type Connection = (typeof traffic.connections)[number];
  const connectionColumns: Column<Connection>[] = [
    col<Connection>("slug", "source", (c) => c.slug),
    col<Connection>("type", "type", (c) => c.source_type),
    col<Connection>("agent", "agent", (c) => c.agent, { end: true }),
    col<Connection>("sync", "sync", (c) => c.sync, { end: true }),
    col<Connection>("app", "app", (c) => c.app, { end: true }),
    col<Connection>("limited", "rate limited", (c) => c.rate_limited, {
      end: true,
    }),
    col<Connection>(
      "share",
      "of calls",
      (c) => pct(c.rate_limited, connectionTotal(c)),
      { end: true },
    ),
    col<Connection>("auth", "auth refused", (c) => c.auth_failures, {
      end: true,
    }),
    col<Connection>("last", "last refusal", (c) => c.last_auth_failure ?? "–"),
  ];
  const connectionFigures = $derived<Count[]>([
    { key: "calls", label: "calls", text: compact(calls) },
    {
      key: "sources",
      label: "sources used",
      value: traffic.connections.length,
    },
    {
      key: "limited",
      label: "rate limited",
      value: rateLimited,
      tone: rateLimited ? "warn" : "muted",
    },
    {
      key: "auth",
      label: "auth refused",
      value: authFailures,
      tone: authFailures ? "danger" : "muted",
    },
  ]);

  type Day = (typeof traffic.per_day)[number];
  const dayColumns: Column<Day>[] = [
    col<Day>("day", "day", (x) => fmtDate(x.day)),
    col<Day>("agent", "agent", (x) => x.agent, { end: true }),
    col<Day>("sync", "sync", (x) => x.sync, { end: true }),
    col<Day>("app", "app", (x) => x.app, { end: true }),
    col<Day>("total", "calls", (x) => connectionTotal(x), { end: true }),
    col<Day>("limited", "rate limited", (x) => x.rate_limited, { end: true }),
    col<Day>("auth", "auth refused", (x) => x.auth_failures, { end: true }),
  ];
  const dayStats = $derived(seriesStats(perDay));
  const dayFigures = $derived<Count[]>([
    { key: "calls", label: "calls", text: compact(dayStats.total) },
    { key: "mean", label: "per day", text: compact(Math.round(dayStats.mean)) },
    {
      key: "peak",
      label: "busiest day",
      text: dayStats.peak
        ? `${dayStats.peak.label} · ${compact(dayStats.peak.value)}`
        : "–",
    },
    { key: "change", label: "vs earlier half", text: signed(dayStats.change) },
    {
      key: "limited",
      label: "rate limited",
      value: rateLimited,
      tone: rateLimited ? "warn" : "muted",
    },
    {
      key: "refused",
      label: "auth refused",
      value: authFailures,
      tone: authFailures ? "danger" : "muted",
    },
  ]);

  const freshColumns: Column<Freshness>[] = [
    col<Freshness>("kind", "kind", (f) => f.kind),
    col<Freshness>("name", "name", (f) => f.label),
    col<Freshness>("last", "last brought up to date", (f) =>
      f.last_at ? new Date(f.last_at).toLocaleString() : "never",
    ),
    col<Freshness>("age", "age", (f) => ago(f.last_at), { end: true }),
    col<Freshness>("error", "last error", (f) => f.error ?? ""),
  ];
  const freshFigures = $derived<Count[]>([
    { key: "all", label: "tracked", value: freshness.data.length },
    {
      key: "stale",
      label: "older than 7 d or never",
      value: stale.length,
      tone: stale.length ? "warn" : "muted",
    },
    {
      key: "failing",
      label: "failing",
      value: freshness.data.filter((f) => f.error).length,
      tone: freshness.data.some((f) => f.error) ? "danger" : "muted",
    },
    {
      key: "oldest",
      label: "oldest",
      text: ago(freshness.data.find((f) => f.last_at)?.last_at ?? null),
    },
  ]);

  const figures = $derived([
    { key: "sources", label: "sources", value: d.connections, to: "sources" },
    { key: "projects", label: "projects", value: d.projects, to: "projects" },
    { key: "repos", label: "repos", value: r.repos, to: "repos" },
    {
      key: "files",
      label: "files",
      text: compact(r.files),
      to: "repos",
      of: "repos",
    },
    {
      key: "chunks",
      label: "chunks",
      text: compact(r.chunks),
      to: "repos",
      of: "repos",
    },
    {
      key: "buckets",
      label: "buckets",
      value: census.data.counts.buckets ?? 0,
      to: "buckets",
    },
    {
      key: "calls",
      label: `calls ${traffic.days} d`,
      text: compact(calls),
    },
    {
      key: "limited",
      label: "rate limited",
      value: rateLimited,
      tone: rateLimited ? ("warn" as const) : ("muted" as const),
      of: "calls",
    },
    {
      key: "refused",
      label: "auth refused",
      value: authFailures,
      tone: authFailures ? ("danger" as const) : ("muted" as const),
      of: "calls",
    },
  ]);
</script>

{#snippet sourcesChart()}
  {#if bySource.length >= 3}
    <Radar
      axes={bySource.map((b) => ({ key: b.key, label: b.label }))}
      series={[
        {
          key: "calls",
          label: "calls",
          tone: "accent",
          values: bySource.map((b) => b.value),
        },
      ]}
      format={compact}
    />
  {:else}
    <Bars rows={bySource} format={compact} legend={[...ORIGINS]} />
  {/if}
{/snippet}
{#snippet connectionTable()}
  <DataTable
    columns={connectionColumns}
    rows={traffic.connections}
    rowKey={(c) => c.slug}
  />
{/snippet}
{#snippet callsChart(days: typeof traffic.per_day)}
  <LineChart
    series={callSeries(days)}
    categories={days.map((d) => d.day)}
    labels={(k) => dayOfMonth(k)}
    format={compact}
  />
{/snippet}
{#snippet dayTable()}
  <DataTable
    columns={dayColumns}
    rows={[...traffic.per_day].reverse()}
    rowKey={(x) => x.day}
  />
{/snippet}
{#snippet freshChart()}
  <div class="fresh">
    <Units groups={freshnessGroups(freshness.data)} />
    <Legend items={[...FRESHNESS_STATES]} />
  </div>
{/snippet}
{#snippet freshTable()}
  <DataTable
    columns={freshColumns}
    rows={freshness.data}
    rowKey={(f) => `${f.kind}:${f.key}`}
  />
{/snippet}

<Overview
  {figures}
  cols={2}
  rows={2}
  loading={census.loading}
  error={census.error ?? activity.error}
>
  <Tile
    title="calls by source"
    key="calls-by-source"
    expand={bySource.length >= 3 ? "chart" : "list"}
    meta="{traffic.days} d"
    empty={!calls}
  >
    {#snippet detail()}
      <Detail
        figures={connectionFigures}
        windowed
        days={traffic.days}
        loading={activity.loading}
        table={connectionTable}
      >
        {@render sourcesChart()}
      </Detail>
    {/snippet}
    {@render sourcesChart()}
  </Tile>

  <Tile
    title="sync freshness"
    key="freshness"
    meta="{freshness.data.length} tracked"
    empty={!freshness.data.length}
  >
    {#snippet detail()}
      <Detail
        figures={freshFigures}
        loading={freshness.loading}
        table={freshTable}
      >
        {@render freshChart()}
      </Detail>
    {/snippet}
    {@render freshChart()}
  </Tile>

  <Tile
    title="source calls"
    key="source-calls"
    span={2}
    meta="{traffic.days} d"
    empty={!calls}
  >
    {#snippet detail()}
      <Detail
        figures={dayFigures}
        windowed
        days={traffic.days}
        loading={activity.loading}
        table={dayTable}
      >
        {@render callsChart(traffic.per_day)}
      </Detail>
    {/snippet}
    {@render callsChart(traffic.per_day.slice(-TILE_DAYS))}
  </Tile>
</Overview>

<style>
  .fresh {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--pad-5, var(--pad-4));
    height: 100%;
    min-height: 0;
  }
</style>
