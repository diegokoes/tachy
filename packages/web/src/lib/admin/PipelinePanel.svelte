<script lang="ts">
  import { Bars, Columns, compact, dayOfMonth, type Bar, type Col } from "../tui";
  import { census } from "./census.svelte";
  import { activity } from "./activity.svelte";
  import { grade, pct, ratio } from "./overview";
  import Dials from "./Dials.svelte";
  import Overview from "./Overview.svelte";
  import Tile from "./Tile.svelte";

  const d = $derived(census.data.detail.sources);
  const r = $derived(census.data.detail.repos);
  const traffic = $derived(activity.data.traffic);

  /* Whose traffic it is — the agent reading on someone's behalf, sync, or the
     app itself — is what a request-rate scrape cannot tell you. */
  const ORIGINS = [
    { key: "agent", label: "agent", tone: "accent" },
    { key: "sync", label: "sync", tone: "info" },
    { key: "app", label: "app", tone: "muted" },
  ] as const;

  const split = (x: { agent: number; sync: number; app: number }) =>
    ORIGINS.map((o) => ({ key: o.key, value: x[o.key], tone: o.tone }));

  const perDay = $derived(
    traffic.per_day.map(
      (x): Col => ({
        key: x.day,
        label: dayOfMonth(x.day),
        title: x.day,
        value: x.agent + x.sync + x.app,
        parts: split(x),
      }),
    ),
  );
  const calls = $derived(perDay.reduce((n, c) => n + c.value, 0));

  const bySource = $derived(
    traffic.connections
      .map(
        (c): Bar => ({
          key: c.slug,
          label: c.slug,
          value: c.agent + c.sync + c.app,
          parts: split(c),
        }),
      )
      .sort((a, b) => b.value - a.value),
  );

  const tokened = $derived(d.connections - d.untokened);
  const wikied = $derived(d.knowledge - d.projects_no_wiki);

  const readiness = $derived([
    {
      key: "sources",
      label: "sources",
      title: "sources with a token",
      value: ratio(tokened, d.connections),
      tone: grade(tokened, d.connections),
      center: pct(tokened, d.connections),
      sub: `${tokened}/${d.connections}`,
    },
    {
      key: "projects",
      label: "projects",
      title: "knowledge projects with a wiki",
      value: ratio(wikied, d.knowledge),
      tone: grade(wikied, d.knowledge),
      center: pct(wikied, d.knowledge),
      sub: `${wikied}/${d.knowledge}`,
    },
    {
      key: "repos",
      label: "repos",
      title: "repos indexed",
      value: ratio(r.ready, r.repos),
      tone: grade(r.ready, r.repos),
      center: pct(r.ready, r.repos),
      sub: `${r.ready}/${r.repos}`,
    },
  ]);

  const figures = $derived([
    { key: "sources", label: "sources", value: d.connections, to: "sources" },
    { key: "projects", label: "projects", value: d.projects, to: "projects" },
    { key: "repos", label: "repos", value: r.repos, to: "repos" },
    { key: "files", label: "files", text: compact(r.files), title: `${r.files.toLocaleString()} files indexed`, to: "repos" },
    { key: "chunks", label: "chunks", text: compact(r.chunks), title: `${r.chunks.toLocaleString()} code chunks`, to: "repos" },
    { key: "calls", label: `calls ${traffic.days} d`, text: compact(calls), title: `source calls, last ${traffic.days} days` },
  ]);
</script>

<Overview
  {figures}
  cols={2}
  rows={2}
  loading={census.loading}
  error={census.error ?? activity.error}
>
  <Tile title="readiness">
    <Dials items={readiness} />
  </Tile>

  <Tile title="calls by source" meta="{traffic.days} d" empty={!calls}>
    <Bars rows={bySource} format={compact} fit />
  </Tile>

  <Tile title="source calls" meta="{traffic.days} d" span={2} empty={!calls}>
    <Columns rows={perDay} format={compact} legend={[...ORIGINS]} fill />
  </Tile>
</Overview>
