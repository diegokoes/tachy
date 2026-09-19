<script lang="ts">
  import { Bars, Columns, compact, dayOfMonth, type Bar, type Col } from "../tui";
  import { showCustomer, t } from "../terms";
  import { activity } from "./activity.svelte";
  import { census } from "./census.svelte";
  import { grade, pct, ratio } from "./overview";
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

  const perProduct = $derived(
    [...c.components_by_product]
      .sort((a, b) => b.n - a.n)
      .map((p): Bar => ({ key: p.slug, label: p.name, value: p.n })),
  );

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
      (d): Col => ({ key: d.day, label: dayOfMonth(d.day), title: d.day, value: d.reads }),
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
        title: d.day,
        value: d.people + d.agent + d.ingest,
        parts: EDITORS.map((e) => ({ key: e.key, value: d[e.key], tone: e.tone })),
      }),
    ),
  );
  const editTotal = $derived(edits.reduce((n, d) => n + d.value, 0));

  const mostRead = $derived(
    library.top.map((item): Bar => ({ key: item.id, label: item.title, value: item.reads })),
  );
</script>

<Overview {figures} loading={census.loading} error={census.error ?? activity.error}>
  <Tile title="described">
    <Dials items={described} />
  </Tile>

  <Tile title="components per {t('product')}" empty={!perProduct.length}>
    <Bars rows={perProduct} unit="components" fit />
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
    <Bars rows={mostRead} format={compact} fit />
  </Tile>
</Overview>
