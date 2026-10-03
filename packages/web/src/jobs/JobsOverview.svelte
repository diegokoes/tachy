<script lang="ts">
  import { fmtDate } from "../dates.svelte";
  import { onMount } from "svelte";
  import {
    Bars,
    Columns,
    Timeline,
    compact,
    dayOfMonth,
    type Bar,
    type Col,
  } from "../tui";
  import {
    duration,
    pct,
    ratio,
    showSection,
    type Tone,
  } from "../admin/overview";
  import { jobs as census } from "./census.svelte";
  import { followLive, live } from "./live.svelte";
  import Dials from "../admin/Dials.svelte";
  import Overview from "../admin/Overview.svelte";
  import Tile from "../admin/Tile.svelte";

  followLive(5_000);

  let from = $state(new Date());
  onMount(async () => {
    await census.reload();
    from = new Date();
  });

  const j = $derived(census.data);
  const failed = $derived(j.by_status.failed + j.by_status.timed_out);

  /* Live counts come from the roster poll, not the census, which loads once. */
  const running = $derived(live.data.queues.reduce((n, q) => n + q.running, 0));
  const queued = $derived(live.data.queues.reduce((n, q) => n + q.queued, 0));
  const aliveWorkers = $derived(
    live.data.workers.filter((w) => w.alive).length,
  );
  const slots = $derived(
    live.data.workers.reduce((n, w) => n + (w.alive ? w.concurrency : 0), 0),
  );
  const unserved = $derived(
    live.data.queues.filter((q) => q.queued && !q.workers).length,
  );

  /* In the order work flows: what is configured, what is happening now, and
     how the window went. */
  const figures = $derived([
    {
      key: "jobs",
      label: "jobs",
      value: j.definitions.total,
      title: `${j.definitions.enabled} enabled · ${j.definitions.disabled} paused`,
      to: "jobs",
    },
    {
      key: "scheduled",
      label: "scheduled",
      value: j.definitions.scheduled,
      title: `enabled jobs on a schedule · ${j.by_trigger.schedule} scheduled runs in ${j.days} d`,
    },
    {
      key: "manual",
      label: "manual",
      value: j.definitions.manual,
      title: `enabled jobs run only by hand · ${j.by_trigger.manual} manual runs in ${j.days} d`,
    },
    {
      key: "queued",
      label: "queued",
      value: queued,
      tone: unserved ? ("danger" as const) : undefined,
      title: "runs waiting for a worker",
      to: "runs",
    },
    {
      key: "running",
      label: "running",
      value: running,
      tone: running ? ("accent" as const) : undefined,
      to: "runs",
    },
    {
      key: "workers",
      label: "workers",
      value: aliveWorkers,
      tone: unserved ? ("danger" as const) : undefined,
      title: unserved
        ? `${unserved} ${unserved === 1 ? "queue has" : "queues have"} runs waiting and no live worker`
        : `${slots} ${slots === 1 ? "slot" : "slots"}`,
      to: "processes",
    },
    {
      key: "succeeded",
      label: `succeeded ${j.days} d`,
      value: j.by_status.succeeded,
      tone: "ok" as const,
    },
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
  ]);

  /* Average wait says whether a pool is big enough; the tone says what the
     queue is doing now. */
  const queues = $derived(
    j.by_queue.flatMap((w): Bar[] => {
      const now = live.data.queues.find((q) => q.name === w.queue);
      if (!w.started && !now?.running && !now?.queued) return [];
      return [
        {
          key: w.queue,
          label: now?.running
            ? `${w.queue} · ${now.running} running`
            : now?.queued
              ? `${w.queue} · ${now.queued} waiting`
              : w.queue,
          value: w.avg_wait_seconds ?? 0,
          tone:
            now?.queued && !now.workers
              ? "danger"
              : now?.queued
                ? "warn"
                : now?.running
                  ? "accent"
                  : undefined,
        },
      ];
    }),
  );

  const OUTCOMES = [
    { key: "succeeded", label: "succeeded", tone: "ok" },
    { key: "failed", label: "failed", tone: "danger" },
    { key: "timed_out", label: "timed out", tone: "warn" },
    { key: "cancelled", label: "cancelled", tone: "muted" },
  ] as const;

  const perDay = $derived(
    j.per_day.map((d): Col => ({
      key: d.day,
      label: dayOfMonth(d.day),
      title: fmtDate(d.day),
      value: OUTCOMES.reduce((n, o) => n + d[o.key], 0),
      parts: OUTCOMES.map((o) => ({
        key: o.key,
        value: d[o.key],
        tone: o.tone,
      })),
    })),
  );
  const shownRuns = $derived(perDay.reduce((n, d) => n + d.value, 0));

  const rate = (s: { finished: number; succeeded: number }): Tone =>
    !s.finished
      ? "muted"
      : s.succeeded / s.finished >= 0.95
        ? "ok"
        : s.succeeded / s.finished >= 0.8
          ? "warn"
          : "danger";
  const ring = (
    key: string,
    label: string,
    s: { finished: number; succeeded: number },
  ) => ({
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
    j.by_kind.map((k): Bar => ({
      key: k.kind,
      label: k.kind,
      value: k.runs,
      parts: [
        { key: "succeeded", value: k.succeeded, tone: "ok" },
        { key: "failed", value: k.failed, tone: "danger" },
        {
          key: "other",
          value: Math.max(0, k.runs - k.succeeded - k.failed),
          tone: "muted",
        },
      ],
    })),
  );

  const byDuration = $derived(
    j.by_kind
      .filter((k) => k.avg_seconds !== null)
      .sort((a, b) => (b.avg_seconds ?? 0) - (a.avg_seconds ?? 0))
      .map((k): Bar => ({
        key: k.kind,
        label: k.kind,
        value: k.avg_seconds ?? 0,
      })),
  );

  const lanes = $derived(
    j.upcoming.map((u) => ({ key: u.id, label: u.name, at: u.at })),
  );
  const firings = $derived(lanes.reduce((n, l) => n + l.at.length, 0));
</script>

<Overview {figures} loading={census.loading} error={census.error} cols={4}>
  <Tile
    title="runs"
    meta={`${compact(shownRuns)} · ${perDay.length} d`}
    span={2}
    empty={!shownRuns}
  >
    <Columns rows={perDay} format={compact} legend={[...OUTCOMES]} fill />
  </Tile>

  <Tile title="success" meta="{j.days} d">
    <Dials items={success} />
  </Tile>

  <Tile title="queue wait" meta="avg · {j.days} d" empty={!queues.length}>
    <Bars
      rows={queues}
      format={duration}
      sum={false}
      fit
      onpick={() => showSection("processes")}
    />
  </Tile>

  <Tile title="runs by kind" meta="{j.days} d" empty={!byKind.length}>
    <Bars rows={byKind} format={compact} fit />
  </Tile>

  <Tile title="avg duration" meta="{j.days} d" empty={!byDuration.length}>
    <Bars rows={byDuration} format={duration} sum={false} fit />
  </Tile>

  <Tile title="next 24 h" meta={`${firings}`} empty={!lanes.length} span={2}>
    <Timeline {lanes} {from} />
  </Tile>
</Overview>
