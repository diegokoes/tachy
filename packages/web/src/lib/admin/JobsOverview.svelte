<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { Bars, Columns, Timeline, compact, dayOfMonth, type Bar, type Col } from "../tui";
  import { duration, pct, ratio, type Tone } from "./overview";
  import type { JobCensus } from "./rows";
  import Dials from "./Dials.svelte";
  import Overview from "./Overview.svelte";
  import Tile from "./Tile.svelte";

  const zero = { light: 0, heavy: 0 };
  const EMPTY: JobCensus = {
    days: 14,
    runs: 0,
    by_status: { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0, timed_out: 0 },
    by_trigger: { schedule: 0, manual: 0, event: 0 },
    by_class: { ...zero },
    per_day: [],
    by_kind: [],
    success: { light: { finished: 0, succeeded: 0 }, heavy: { finished: 0, succeeded: 0 } },
    now: { light: { running: 0, queued: 0 }, heavy: { running: 0, queued: 0 } },
    definitions: { total: 0, enabled: 0, scheduled: 0, manual: 0, disabled: 0 },
    upcoming: [],
  };

  let from = $state(new Date());
  const census = createResource(async () => {
    const got = await api.get<JobCensus>("/jobs/census");
    from = new Date();
    return { ...EMPTY, ...got };
  }, EMPTY);
  onMount(() => census.reload());

  const j = $derived(census.data);
  const failed = $derived(j.by_status.failed + j.by_status.timed_out);
  const running = $derived(j.now.light.running + j.now.heavy.running);

  const figures = $derived([
    { key: "runs", label: `runs ${j.days} d`, value: j.runs },
    { key: "succeeded", label: "succeeded", value: j.by_status.succeeded, tone: "ok" as const },
    { key: "failed", label: "failed", value: failed, tone: failed ? ("danger" as const) : ("muted" as const), title: "failed or timed out" },
    { key: "light", label: "light", value: j.by_class.light, title: "runs on the light pool" },
    { key: "heavy", label: "heavy", value: j.by_class.heavy, title: "runs on the heavy pool" },
    { key: "scheduled", label: "scheduled", value: j.by_trigger.schedule, title: "runs the scheduler started" },
    { key: "manual", label: "manual", value: j.by_trigger.manual, title: "runs someone started" },
    {
      key: "running",
      label: "running",
      value: running,
      title: `${j.now.light.queued + j.now.heavy.queued} queued`,
      to: "jobs",
    },
  ]);

  const OUTCOMES = [
    { key: "succeeded", label: "succeeded", tone: "ok" },
    { key: "failed", label: "failed", tone: "danger" },
    { key: "timed_out", label: "timed out", tone: "warn" },
    { key: "cancelled", label: "cancelled", tone: "muted" },
  ] as const;

  const perDay = $derived(
    j.per_day.map(
      (d): Col => ({
        key: d.day,
        label: dayOfMonth(d.day),
        title: d.day,
        value: OUTCOMES.reduce((n, o) => n + d[o.key], 0),
        parts: OUTCOMES.map((o) => ({ key: o.key, value: d[o.key], tone: o.tone })),
      }),
    ),
  );
  const shownRuns = $derived(perDay.reduce((n, d) => n + d.value, 0));

  const rate = (s: { finished: number; succeeded: number }): Tone =>
    !s.finished ? "muted" : s.succeeded / s.finished >= 0.95 ? "ok" : s.succeeded / s.finished >= 0.8 ? "warn" : "danger";
  const ring = (key: string, label: string, s: { finished: number; succeeded: number }) => ({
    key,
    label,
    title: `${label}: finished runs that succeeded`,
    value: ratio(s.succeeded, s.finished),
    tone: rate(s),
    center: pct(s.succeeded, s.finished),
    sub: `${s.succeeded}/${s.finished}`,
  });
  const success = $derived([
    ring("all", "all", {
      finished: j.success.light.finished + j.success.heavy.finished,
      succeeded: j.success.light.succeeded + j.success.heavy.succeeded,
    }),
    ring("light", "light", j.success.light),
    ring("heavy", "heavy", j.success.heavy),
  ]);

  const byKind = $derived(
    j.by_kind.map(
      (k): Bar => ({
        key: k.kind,
        label: k.kind,
        value: k.runs,
        parts: [
          { key: "succeeded", value: k.succeeded, tone: "ok" },
          { key: "failed", value: k.failed, tone: "danger" },
          { key: "other", value: Math.max(0, k.runs - k.succeeded - k.failed), tone: "muted" },
        ],
      }),
    ),
  );

  const byDuration = $derived(
    j.by_kind
      .filter((k) => k.avg_seconds !== null)
      .sort((a, b) => (b.avg_seconds ?? 0) - (a.avg_seconds ?? 0))
      .map((k): Bar => ({ key: k.kind, label: k.kind, value: k.avg_seconds ?? 0 })),
  );

  const lanes = $derived(j.upcoming.map((u) => ({ key: u.id, label: u.name, at: u.at })));
  const firings = $derived(lanes.reduce((n, l) => n + l.at.length, 0));
</script>

<Overview {figures} loading={census.loading} error={census.error}>
  <Tile title="runs" meta={`${compact(shownRuns)} · ${perDay.length} d`} span={2} empty={!shownRuns}>
    <Columns rows={perDay} format={compact} legend={[...OUTCOMES]} fill />
  </Tile>

  <Tile title="success" meta="{j.days} d">
    <Dials items={success} />
  </Tile>

  <Tile title="runs by kind" meta="{j.days} d" empty={!byKind.length}>
    <Bars rows={byKind} format={compact} fit />
  </Tile>

  <Tile title="avg duration" meta="{j.days} d" empty={!byDuration.length}>
    <Bars rows={byDuration} format={duration} sum={false} fit />
  </Tile>

  <Tile title="next 24 h" meta={`${firings}`} empty={!lanes.length}>
    <Timeline {lanes} {from} />
  </Tile>
</Overview>
