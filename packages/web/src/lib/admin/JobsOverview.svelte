<script lang="ts">
  import { onMount } from "svelte";
  import { Bars, Columns, Timeline, compact, dayOfMonth, type Bar, type Col } from "../tui";
  import { duration, pct, ratio, type Tone } from "./overview";
  import { jobs as census } from "./jobCensus.svelte";
  import Dials from "./Dials.svelte";
  import Overview from "./Overview.svelte";
  import Tile from "./Tile.svelte";

  let from = $state(new Date());
  onMount(async () => {
    await census.reload();
    from = new Date();
  });

  const j = $derived(census.data);
  const failed = $derived(j.by_status.failed + j.by_status.timed_out);
  const running = $derived(j.now.light.running + j.now.heavy.running);

  /* Jobs, not runs, where the two differ. The success rings already carry the
     run totals per pool, so a "runs 14 d" counter and a "light: 46 runs"
     counter were saying the rings' numbers a second time. */
  const figures = $derived([
    {
      key: "jobs",
      label: "jobs",
      value: j.definitions.total,
      title: `${j.definitions.enabled} enabled · ${j.definitions.disabled} paused`,
      to: "jobs",
    },
    { key: "succeeded", label: `succeeded ${j.days} d`, value: j.by_status.succeeded, tone: "ok" as const },
    {
      key: "failed",
      label: `failed ${j.days} d`,
      value: failed,
      tone: failed ? ("danger" as const) : ("muted" as const),
      title: failed
        ? `${j.failures.length} ${j.failures.length === 1 ? "job" : "jobs"} failed. Open to see which`
        : "failed or timed out",
      to: failed ? "failures" : undefined,
    },
    { key: "light", label: "light", value: j.definitions.by_class.light, title: "jobs that run on the light pool" },
    { key: "heavy", label: "heavy", value: j.definitions.by_class.heavy, title: "jobs that run on the heavy pool, holding chat slots while they do" },
    { key: "scheduled", label: "scheduled", value: j.definitions.scheduled, title: `enabled jobs on a schedule · ${j.by_trigger.schedule} scheduled runs in ${j.days} d` },
    { key: "manual", label: "manual", value: j.definitions.manual, title: `enabled jobs run only by hand · ${j.by_trigger.manual} manual runs in ${j.days} d` },
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
