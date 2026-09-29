<script lang="ts">
  import { fmtDate } from "../dates.svelte";
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { navigate } from "../router.svelte";
  import {
    Bars,
    Columns,
    Icon,
    Treemap,
    compact,
    dayOfMonth,
    type Bar,
    type Col,
  } from "../tui";
  import { showCustomer, t } from "../terms";
  import { activity } from "./activity.svelte";
  import { census } from "./census.svelte";
  import { coverageTree } from "./coverage";
  import { grade, pct, ratio, showSection } from "./overview";
  import type { ComponentCoverage } from "./rows";
  import Dials, { type DialItem } from "./Dials.svelte";
  import Overview from "./Overview.svelte";
  import Tile from "./Tile.svelte";

  const c = $derived(census.data.detail.catalog);
  const k = $derived(census.data.detail.knowledge);
  const library = $derived(activity.data.library);

  const figures = $derived([
    { key: "teams", label: t("teams"), value: c.teams, to: "teams" },
    { key: "products", label: t("products"), value: c.products, to: "products" },
    { key: "components", label: "components", value: c.components, to: "components" },
    { key: "labels", label: "labels", value: c.labels, to: "labels" },
    { key: "patterns", label: "patterns", value: c.patterns, to: "patterns" },
    { key: "entries", label: "entries", value: k.entries, title: "knowledge entries" },
    ...(showCustomer()
      ? [{ key: "customers", label: t("customers"), value: c.customers, to: "customers" }]
      : []),
  ]);

  /* A description is what an incoming question is matched against, so an
     undescribed component is one the agent cannot pick. */
  const ring = (key: string, label: string, n: number, missing: number, title: string): DialItem => ({
    key,
    label,
    title,
    value: ratio(n - missing, n),
    tone: grade(n - missing, n),
    center: pct(n - missing, n),
    sub: `${n - missing}/${n}`,
  });

  const described = $derived([
    ring("components", "components", c.components, c.components_no_description, "components with a description"),
    ring("labels", "labels", c.labels, c.labels_no_description, "labels with a description"),
    ring("patterns", "patterns", c.patterns, c.patterns_no_description, "resolution patterns with a description"),
    ...(showCustomer()
      ? [ring("customers", t("customers"), c.customers, c.customers_no_domains, `${t("customers")} with an email domain`)]
      : []),
  ]);

  const coverage = createResource(
    () => api.get<ComponentCoverage[]>("/overview/components"),
    [],
  );
  onMount(() => void coverage.reload());
  const map = $derived(coverageTree(coverage.data, t("products")));

  /* Ordered as an entry moves through its life, not by size, so the chart
     reads the same on every deployment. */
  const STATUS_TONES = {
    approved: "ok",
    draft: "accent",
    deprecated: "warn",
    rejected: "danger",
    archived: "muted",
  } as const;

  const statuses = $derived(
    Object.entries(STATUS_TONES).map(
      ([key, tone]): Col => ({ key, label: key, value: k.by_status[key] ?? 0, tone }),
    ),
  );

  const reads = $derived(
    library.per_day.map(
      (d): Col => ({ key: d.day, label: dayOfMonth(d.day), title: fmtDate(d.day), value: d.reads }),
    ),
  );
  const readTotal = $derived(reads.reduce((n, d) => n + d.value, 0));

  const EDITORS = [
    { key: "people", label: "people", tone: "accent" },
    { key: "agent", label: "agent", tone: "info" },
    { key: "ingest", label: "ingest", tone: "muted" },
  ] as const;

  const edits = $derived(
    library.edits_per_day.map(
      (d): Col => ({
        key: d.day,
        label: dayOfMonth(d.day),
        title: fmtDate(d.day),
        value: d.people + d.agent + d.ingest,
        parts: EDITORS.map((e) => ({ key: e.key, value: d[e.key], tone: e.tone })),
      }),
    ),
  );
  const editTotal = $derived(edits.reduce((n, d) => n + d.value, 0));

  const openRead = (b: Bar) => {
    const item = library.top.find((x) => x.id === b.key);
    if (item) navigate(`/library/${item.kind === "doc" ? "docs" : "entries"}/${item.id}`);
  };

  const mostRead = $derived(
    library.top.map((item): Bar => ({ key: item.id, label: item.title, value: item.reads })),
  );
</script>

<Overview {figures} loading={census.loading} error={census.error ?? activity.error}>
  <Tile title="described">
    <Dials items={described} />
  </Tile>

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

  <Tile title="entries by status" meta={`${k.entries}`} empty={!k.entries}>
    <Columns rows={statuses} fill />
  </Tile>

  <Tile title="reads" meta={`${compact(readTotal)} · ${reads.length} d`} empty={!readTotal}>
    <Columns rows={reads} format={compact} fill />
  </Tile>

  <Tile title="edits" meta={`${compact(editTotal)} · ${edits.length} d`} empty={!editTotal}>
    <Columns rows={edits} format={compact} legend={[...EDITORS]} fill />
  </Tile>

  <Tile title="most read" meta="{library.days} d" empty={!mostRead.length}>
    <Bars rows={mostRead} format={compact} fit onpick={openRead} />
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
