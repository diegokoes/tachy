<script lang="ts">
  import { onMount } from "svelte";
  import { fmtDate } from "../dates.svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { navigate } from "../shell/router.svelte";
  import {
    Bars,
    Columns,
    DataTable,
    Icon,
    Treemap,
    Waffle,
    Figures,
    type FigureItem,
    Radar,
    type WaffleItem,
    compact,
    dayOfMonth,
    type Bar,
    type Col,
    type Column,
  } from "../tui";
  import { showCustomer, t } from "../terms";
  import { activity } from "../admin/activity.svelte";
  import { census } from "../admin/census.svelte";
  import { coverageTree } from "./coverage";
  import { showSection, type Count } from "../admin/overview";
  import Detail from "../admin/Detail.svelte";
  import { col, seriesStats, signed, TILE_DAYS } from "../admin/detail";
  import { stale } from "./stale.svelte";
  import type { KnowledgeStale } from "@tachy/contract";
  import type { ComponentCoverage } from "./rows";
  import Overview from "../admin/Overview.svelte";
  import Tile from "../admin/Tile.svelte";

  const c = $derived(census.data.detail.catalog);
  const k = $derived(census.data.detail.knowledge);
  const library = $derived(activity.data.library);

  const figures = $derived([
    { key: "teams", label: t("teams"), value: c.teams, to: "teams" },
    {
      key: "products",
      label: t("products"),
      value: c.products,
      to: "products",
    },
    {
      key: "components",
      label: "components",
      value: c.components,
      to: "components",
    },
    { key: "labels", label: "labels", value: c.labels, to: "labels" },
    { key: "patterns", label: "patterns", value: c.patterns, to: "patterns" },
    {
      key: "entries",
      label: "entries",
      value: k.entries,
    },
    ...(showCustomer()
      ? [
          {
            key: "customers",
            label: t("customers"),
            value: c.customers,
            to: "customers",
          },
        ]
      : []),
  ]);

  const coverage = createResource(
    () => api.get<ComponentCoverage[]>("/overview/components"),
    [],
  );
  // Follows the census: a dialog section over this overview changes products
  // without unmounting it, and the census is what gets recounted on close.
  $effect(() => {
    if (!census.loading) void coverage.reload();
  });
  const map = $derived(coverageTree(coverage.data, t("products")));

  // Ordered as an entry moves through its life, not by size, so the chart reads
  // the same on every deployment.
  const STATUS_TONES = {
    approved: "ok",
    draft: "accent",
    deprecated: "warn",
    rejected: "danger",
    archived: "muted",
  } as const;

  const statuses = $derived(
    Object.entries(STATUS_TONES).map(([key, tone]): Col => ({
      key,
      label: key,
      value: k.by_status[key] ?? 0,
      tone,
    })),
  );

  const statusColumns: Column<Col>[] = [
    col<Col>("status", "status", (x) => x.label),
    col<Col>("n", "entries", (x) => x.value, { end: true }),
    col<Col>(
      "share",
      "of entries",
      (x) => (k.entries ? `${Math.round((x.value / k.entries) * 100)}%` : "–"),
      { end: true },
    ),
  ];
  const statusFigures = $derived<Count[]>([
    { key: "entries", label: "entries", value: k.entries },
    {
      key: "approved",
      label: "approved",
      value: k.by_status.approved ?? 0,
      tone: "ok",
    },
    {
      key: "nocomponent",
      label: "in no component",
      value: k.entries_no_component,
      tone: k.entries_no_component ? "warn" : "muted",
    },
    {
      key: "noproduct",
      label: "in no product",
      value: k.entries_no_product,
      tone: k.entries_no_product ? "warn" : "muted",
    },
  ]);

  const reads = $derived(
    library.per_day.map((d): Col => ({
      key: d.day,
      label: dayOfMonth(d.day),
      title: fmtDate(d.day),
      value: d.reads,
    })),
  );
  const tileReads = $derived(reads.slice(-TILE_DAYS));
  const readTotal = $derived(tileReads.reduce((n, d) => n + d.value, 0));
  const readStats = $derived(seriesStats(reads));

  const EDITORS = [
    { key: "people", label: "people", tone: "accent" },
    { key: "agent", label: "agent", tone: "info" },
    { key: "ingest", label: "ingest", tone: "muted" },
  ] as const;

  const edits = $derived(
    library.edits_per_day.map((d): Col => ({
      key: d.day,
      label: dayOfMonth(d.day),
      title: fmtDate(d.day),
      value: d.people + d.agent + d.ingest,
      parts: EDITORS.map((e) => ({
        key: e.key,
        value: d[e.key],
        tone: e.tone,
      })),
    })),
  );
  const tileEdits = $derived(edits.slice(-TILE_DAYS));
  const editTotal = $derived(tileEdits.reduce((n, d) => n + d.value, 0));
  const editStats = $derived(seriesStats(edits));

  type Day = (typeof library.per_day)[number];
  type Edit = (typeof library.edits_per_day)[number];
  type Top = (typeof library.top)[number];
  type Weak = KnowledgeStale["weakest"][number];

  const dayColumns: Column<Day>[] = [
    col<Day>("day", "day", (d) => fmtDate(d.day)),
    col<Day>("reads", "reads", (d) => d.reads, { end: true }),
  ];
  const editColumns: Column<Edit>[] = [
    col<Edit>("day", "day", (d) => fmtDate(d.day)),
    ...EDITORS.map((e) =>
      col<Edit>(e.key, e.label, (d) => d[e.key], { end: true }),
    ),
    col<Edit>("total", "edits", (d) => d.people + d.agent + d.ingest, {
      end: true,
    }),
  ];
  const topColumns: Column<Top>[] = [
    col<Top>("title", "title", (i) => i.title),
    col<Top>("kind", "kind", (i) => i.kind),
    col<Top>("reads", "reads", (i) => i.reads, { end: true }),
    col<Top>("readers", "readers", (i) => i.readers, { end: true }),
  ];
  const readFigures = $derived<Count[]>([
    { key: "reads", label: "reads", text: compact(readStats.total) },
    { key: "readers", label: "readers", value: library.readers },
    {
      key: "mean",
      label: "per day",
      text: compact(Math.round(readStats.mean)),
    },
    {
      key: "peak",
      label: "busiest day",
      text: readStats.peak
        ? `${readStats.peak.label} · ${compact(readStats.peak.value)}`
        : "–",
    },
    {
      key: "fixes",
      label: "corrections filed",
      value: library.corrections,
      tone: library.corrections ? "warn" : "muted",
    },
    { key: "change", label: "vs earlier half", text: signed(readStats.change) },
  ]);
  const editFigures = $derived<Count[]>([
    { key: "edits", label: "edits", text: compact(editStats.total) },
    ...EDITORS.map((e) => ({
      key: e.key,
      label: e.label,
      text: compact(library.edits_per_day.reduce((n, d) => n + d[e.key], 0)),
    })),
    { key: "change", label: "vs earlier half", text: signed(editStats.change) },
  ]);

  const AGE_LABELS = {
    week: "< 7 d",
    month: "< 30 d",
    quarter: "< 90 d",
    older: "older",
  } as const;
  const draftAges = $derived(
    stale.data.drafts.map((d): Col => ({
      key: d.age,
      label: AGE_LABELS[d.age],
      title: `drafts waiting ${AGE_LABELS[d.age]}`,
      value: d.n,
      tone: d.age === "older" ? "warn" : undefined,
    })),
  );
  const draftTotal = $derived(stale.data.drafts.reduce((n, d) => n + d.n, 0));
  const oldDrafts = $derived(
    stale.data.drafts
      .filter((d) => d.age === "older" || d.age === "quarter")
      .reduce((n, d) => n + d.n, 0),
  );
  const approved = $derived(k.by_status.approved ?? 0);
  const share = (n: number, of: number) =>
    of ? Math.round((n / of) * 100) : 0;
  const backlogFigures = $derived<FigureItem[]>([
    {
      key: "drafts",
      value: `${share(oldDrafts, draftTotal)}%`,
      label: "drafts waiting > 30 d",
      note: `${oldDrafts} of ${draftTotal} drafts`,
      tone: "warn",
    },
    {
      key: "untouched",
      value: `${share(stale.data.untouched, approved)}%`,
      label: "approved, not edited in 12 mo",
      note: `${stale.data.untouched} of ${approved}`,
      tone: "warn",
    },
    {
      key: "unread",
      value: `${share(stale.data.unread, approved)}%`,
      label: "approved, unread in 90 d",
      note: `${stale.data.unread} of ${approved}`,
      tone: "accent",
    },
    {
      key: "doubtful",
      value: `${share(stale.data.doubtful, approved)}%`,
      label: "approved, doubtful",
      note: `${stale.data.doubtful} of ${approved}`,
      tone: "danger",
    },
  ]);
  const staleFigures = $derived<Count[]>([
    { key: "drafts", label: "drafts", value: draftTotal },
    {
      key: "old",
      label: "drafts > 30 d",
      value: oldDrafts,
      tone: oldDrafts ? "warn" : "muted",
    },
    { key: "untouched", label: "stale 12 mo", value: stale.data.untouched },
    { key: "unread", label: "unread 90 d", value: stale.data.unread },
    {
      key: "doubtful",
      label: "doubtful",
      value: stale.data.doubtful,
      tone: stale.data.doubtful ? "danger" : "muted",
    },
  ]);
  const weakColumns: Column<Weak>[] = [
    col<Weak>("title", "weakest rated", (w) => w.title || "untitled entry"),
    col<Weak>("rating", "avg rating", (w) => w.rating.toFixed(1), {
      end: true,
    }),
    col<Weak>("ratings", "ratings", (w) => w.ratings, { end: true }),
    col<Weak>("reads", "reads 90 d", (w) => w.reads, { end: true }),
  ];

  onMount(() => void stale.reload());

  const openRead = (b: Bar) => {
    const item = library.top.find((x) => x.id === b.key);
    if (item)
      navigate(
        `/library/${item.kind === "doc" ? "docs" : "entries"}/${item.id}`,
      );
  };

  const mostRead = $derived(
    library.top.map((item): Bar => ({
      key: item.id,
      label: item.title,
      value: item.reads,
    })),
  );
</script>

{#snippet statusChart()}
  <Radar
    axes={statuses.map((x) => ({ key: x.key, label: x.label, tone: x.tone }))}
    series={[
      {
        key: "entries",
        label: "entries",
        tone: "accent",
        values: statuses.map((x) => x.value),
      },
    ]}
    format={compact}
  />
{/snippet}
{#snippet statusTable()}
  <DataTable columns={statusColumns} rows={statuses} rowKey={(x) => x.key} />
{/snippet}
{#snippet readsChart(rows: Col[])}
  <Columns {rows} format={compact} fill />
{/snippet}
{#snippet editsChart(rows: Col[])}
  <Columns {rows} format={compact} legend={[...EDITORS]} fill />
{/snippet}
{#snippet readsTable()}
  <DataTable
    columns={dayColumns}
    rows={[...library.per_day].reverse()}
    rowKey={(d) => d.day}
  />
{/snippet}
{#snippet editsTable()}
  <DataTable
    columns={editColumns}
    rows={[...library.edits_per_day].reverse()}
    rowKey={(d) => d.day}
  />
{/snippet}
{#snippet readTop()}
  <Bars rows={mostRead} format={compact} onpick={openRead} />
{/snippet}
{#snippet topTable()}
  <DataTable
    columns={topColumns}
    rows={library.top}
    rowKey={(i) => i.id}
    onrowclick={(i) => openRead({ key: i.id, label: i.title, value: i.reads })}
  />
{/snippet}
{#snippet staleChart()}
  <Figures items={backlogFigures} />
{/snippet}
{#snippet staleDetailChart()}
  <Columns rows={draftAges} fill />
{/snippet}
{#snippet staleTable()}
  <DataTable
    columns={weakColumns}
    rows={stale.data.weakest}
    rowKey={(w) => w.id}
    emptyTitle="No entry has been rated yet."
    onrowclick={(w) => navigate(`/library/entries/${w.id}`)}
  />
{/snippet}

<Overview
  {figures}
  loading={census.loading}
  error={census.error ?? activity.error}
>
  <Tile title="entries per component" empty={!coverage.data.length}>
    <button
      type="button"
      class="preview"
      aria-label="enlarge the map"
      onclick={() => showSection("map")}
    >
      <span class="shapes"><Treemap root={map} bare /></span>
      <span class="shapes edges"><Treemap root={map} bare edges /></span>
      <span class="cue"><Icon name="enlarge" size="1.1rem" weight={8} /></span>
    </button>
  </Tile>

  <Tile
    title="entries by status"
    key="status"
    meta={`${k.entries}`}
    empty={!k.entries}
  >
    {#snippet detail()}
      <Detail figures={statusFigures} table={statusTable}>
        {@render statusChart()}
      </Detail>
    {/snippet}
    {@render statusChart()}
  </Tile>

  <Tile
    title="most read"
    key="most-read"
    expand="list"
    meta="{library.days} d"
    empty={!mostRead.length}
  >
    {#snippet detail()}
      <Detail
        figures={readFigures}
        windowed
        days={library.days}
        loading={activity.loading}
        table={topTable}
      >
        {@render readTop()}
      </Detail>
    {/snippet}
    {@render readTop()}
  </Tile>

  <Tile
    title="edits"
    key="edits"
    meta={`${compact(editTotal)} · ${tileEdits.length} d`}
    empty={!editTotal}
  >
    {#snippet detail()}
      <Detail
        figures={editFigures}
        windowed
        days={library.days}
        loading={activity.loading}
        table={editsTable}
      >
        {@render editsChart(edits)}
      </Detail>
    {/snippet}
    {@render editsChart(tileEdits)}
  </Tile>

  <Tile
    title="reads"
    key="reads"
    meta={`${compact(readTotal)} · ${tileReads.length} d`}
    empty={!readTotal}
  >
    {#snippet detail()}
      <Detail
        figures={readFigures}
        windowed
        days={library.days}
        loading={activity.loading}
        table={readsTable}
      >
        {@render readsChart(reads)}
      </Detail>
    {/snippet}
    {@render readsChart(tileReads)}
  </Tile>

  <Tile
    title="review backlog"
    key="backlog"
    meta="{draftTotal} drafts"
    empty={!k.by_status.approved && !k.by_status.draft}
  >
    {#snippet detail()}
      <Detail figures={staleFigures} loading={stale.loading} table={staleTable}>
        {@render staleDetailChart()}
      </Detail>
    {/snippet}
    {@render staleChart()}
  </Tile>
</Overview>

<style>
  .preview {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: zoom-in;
  }
  .shapes {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    filter: blur(1.5px) saturate(0.7);
    opacity: 0.55;
    transition:
      filter 0.2s ease,
      opacity 0.2s ease;
  }
  .shapes.edges {
    position: absolute;
    inset: 0;
    filter: none;
    opacity: 0.7;
  }
  .cue {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    transition:
      color 0.2s ease,
      transform 0.2s ease;
  }
  .cue :global(.icon) {
    color: color-mix(in srgb, var(--text) 85%, transparent);
    padding: 0.45rem;
    transition:
      color 0.2s ease,
      stroke-width 0.2s ease;
    border-radius: 50%;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    box-sizing: content-box;
  }
  .preview:hover .shapes,
  .preview:focus-visible .shapes {
    filter: none;
    opacity: 0.8;
  }
  .preview:hover .cue,
  .preview:focus-visible .cue {
    transform: scale(1.7);
  }
  .preview:hover .cue :global(.icon),
  .preview:focus-visible .cue :global(.icon) {
    color: var(--text);
    stroke-width: 2.75;
  }
  .preview:focus-visible {
    outline: 1px solid var(--text);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .shapes,
    .cue,
    .cue :global(.icon) {
      transition: none;
    }
  }
</style>
