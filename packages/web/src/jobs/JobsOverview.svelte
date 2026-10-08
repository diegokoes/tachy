<script lang="ts">
  import { fmtDate } from "../dates.svelte";
  import { onMount } from "svelte";
  import {
    Bars,
    Columns,
    DataTable,
    Ratios,
    Timeline,
    compact,
    dayOfMonth,
    type Bar,
    type Col,
    type Column,
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
  import Detail from "../admin/Detail.svelte";
  import { col, seriesStats, signed } from "../admin/detail";
  import type { Count } from "../admin/overview";
  import Stack from "../admin/Stack.svelte";
  import Overview from "../admin/Overview.svelte";
  import Tile from "../admin/Tile.svelte";

  followLive(5_000);

  let from = $state(new Date());
  onMount(async () => {
    await census.reload();
    from = new Date();
  });

  const totals = $derived(census.data);

  type LiveQueue = (typeof live.data.queues)[number];
  const queueLabel = (name: string, now?: LiveQueue) => {
    if (now?.running) return `${name} · ${now.running} running`;
    return now?.queued ? `${name} · ${now.queued} waiting` : name;
  };
  const queueTone = (now?: LiveQueue): Bar["tone"] => {
    if (now?.queued) return now.workers ? "warn" : "danger";
    return now?.running ? "accent" : undefined;
  };
  const failed = $derived(totals.by_status.failed + totals.by_status.timed_out);

  // Live counts come from the roster poll, not the census, which loads once.
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

  // In the order work flows: what is configured, what is happening now, and how
  // the window went.
  const figures = $derived([
    {
      key: "jobs",
      label: "schedule",
      value: totals.definitions.total,
      to: "jobs",
    },
    {
      key: "scheduled",
      label: "scheduled",
      value: totals.definitions.scheduled,
      to: "jobs",
      of: "jobs",
    },
    {
      key: "manual",
      label: "manual",
      value: totals.definitions.manual,
      to: "jobs",
      of: "jobs",
    },
    ...(totals.definitions.disabled
      ? [
          {
            key: "disabled",
            label: "off",
            value: totals.definitions.disabled,
            tone: "muted" as const,
            to: "jobs",
            of: "jobs",
          },
        ]
      : []),
    {
      key: "queued",
      label: "queued",
      value: queued,
      tone: unserved ? ("danger" as const) : undefined,
      to: "queues",
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
      to: "processes",
    },
    {
      key: "succeeded",
      label: `succeeded ${totals.days} d`,
      value: totals.by_status.succeeded,
      tone: "ok" as const,
    },
    {
      key: "failed",
      label: `failed ${totals.days} d`,
      value: failed,
      tone: failed ? ("danger" as const) : ("muted" as const),
      to: failed ? "failures" : undefined,
    },
  ]);

  // Average wait says whether a pool is big enough; the tone says what the
  // queue is doing now.
  const queues = $derived(
    totals.by_queue.flatMap((w): Bar[] => {
      const now = live.data.queues.find((q) => q.name === w.queue);
      if (!w.started && !now?.running && !now?.queued) return [];
      return [
        {
          key: w.queue,
          label: queueLabel(w.queue, now),
          value: w.avg_wait_seconds ?? 0,
          tone: queueTone(now),
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
    totals.per_day.map((d): Col => ({
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

  const SUCCESS_OK = 0.95;
  const SUCCESS_WARN = 0.8;
  const rate = (s: { finished: number; succeeded: number }): Tone => {
    if (!s.finished) return "muted";
    const share = s.succeeded / s.finished;
    if (share >= SUCCESS_OK) return "ok";
    return share >= SUCCESS_WARN ? "warn" : "danger";
  };
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
      finished: totals.success.light.finished + totals.success.heavy.finished,
      succeeded:
        totals.success.light.succeeded + totals.success.heavy.succeeded,
    }),
    ring("light", "light", totals.success.light),
    ring("heavy", "heavy", totals.success.heavy),
  ]);

  const KIND_PARTS = [
    { key: "succeeded", label: "succeeded", tone: "ok" },
    { key: "failed", label: "failed", tone: "danger" },
    { key: "other", label: "other", tone: "muted" },
  ] as const;

  const byKind = $derived(
    totals.by_kind.map((k): Bar => ({
      key: k.kind,
      label: k.title,
      value: k.runs,
      aside: k.avg_seconds === null ? undefined : duration(k.avg_seconds),
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

  const lanes = $derived(
    totals.upcoming.map((u) => ({ key: u.id, label: u.name, at: u.at })),
  );
  const firings = $derived(lanes.reduce((n, l) => n + l.at.length, 0));

  type Kind = (typeof totals.by_kind)[number];
  const outcome = (n: number, of: number) => (of ? pct(n, of) : "–");

  const runStats = $derived(seriesStats(perDay));
  const runFigures = $derived<Count[]>([
    { key: "runs", label: "runs", value: runStats.total },
    {
      key: "rate",
      label: "success rate",
      text: pct(
        totals.success.light.succeeded + totals.success.heavy.succeeded,
        totals.success.light.finished + totals.success.heavy.finished,
      ),
    },
    {
      key: "failed",
      label: "failed",
      value: failed,
      tone: failed ? "danger" : "muted",
    },
    { key: "mean", label: "per day", text: compact(Math.round(runStats.mean)) },
    {
      key: "peak",
      label: "busiest day",
      text: runStats.peak
        ? `${runStats.peak.label} · ${runStats.peak.value}`
        : "–",
    },
    { key: "change", label: "vs earlier half", text: signed(runStats.change) },
  ]);
  const runColumns: Column<Col>[] = [
    col<Col>("day", "day", (r) => r.title ?? r.label),
    col<Col>("total", "runs", (r) => r.value, { end: true }),
    ...OUTCOMES.map((o) =>
      col<Col>(
        o.key,
        o.label,
        (r) => r.parts?.find((p) => p.key === o.key)?.value ?? 0,
        { end: true },
      ),
    ),
    col<Col>(
      "rate",
      "success",
      (r) =>
        outcome(
          r.parts?.find((p) => p.key === "succeeded")?.value ?? 0,
          r.value,
        ),
      { end: true },
    ),
  ];

  const kindColumns: Column<Kind>[] = [
    col<Kind>("job", "job", (k) => k.title),
    col<Kind>("runs", "runs", (k) => k.runs, { end: true }),
    col<Kind>("failed", "failed", (k) => k.failed, { end: true }),
    col<Kind>("rate", "success", (k) => outcome(k.succeeded, k.runs), {
      end: true,
    }),
    col<Kind>(
      "avg",
      "avg",
      (k) => (k.avg_seconds === null ? "–" : duration(k.avg_seconds)),
      { end: true },
    ),
    col<Kind>(
      "p50",
      "p50",
      (k) => (k.p50_seconds === null ? "–" : duration(k.p50_seconds)),
      { end: true },
    ),
    col<Kind>(
      "p95",
      "p95",
      (k) => (k.p95_seconds === null ? "–" : duration(k.p95_seconds)),
      { end: true },
    ),
    col<Kind>(
      "limit",
      "of timeout",
      (k) =>
        k.p95_seconds === null || !k.timeout_ms
          ? "–"
          : pct(k.p95_seconds * 1000, k.timeout_ms),
      { end: true },
    ),
    col<Kind>("retried", "retried", (k) => k.retried, { end: true }),
  ];
  const slowest = $derived(
    [...totals.by_kind].sort(
      (a, b) => (b.p95_seconds ?? 0) - (a.p95_seconds ?? 0),
    )[0],
  );

  const kindFigures = $derived<Count[]>([
    { key: "jobs", label: "jobs that ran", value: totals.by_kind.length },
    { key: "runs", label: "runs", value: totals.runs },
    {
      key: "retried",
      label: "retried",
      value: totals.by_kind.reduce((n, k) => n + k.retried, 0),
    },
    {
      key: "slowest",
      label: slowest ? `slowest p95 · ${slowest.title}` : "slowest p95",
      text: slowest ? duration(slowest.p95_seconds ?? 0) : "–",
    },
  ]);

  const waitPerDay = $derived.by((): Col[] => {
    const days = new Map<string, number[]>();
    for (const w of totals.wait_per_day) {
      const list = days.get(w.day) ?? [];
      list.push(w.avg_wait_seconds);
      days.set(w.day, list);
    }
    return [...days].map(([day, waits]) => ({
      key: day,
      label: dayOfMonth(day),
      title: fmtDate(day),
      value: waits.reduce((n, w) => n + w, 0) / waits.length,
    }));
  });
  const queueColumns: Column<(typeof totals.by_queue)[number]>[] = [
    col<(typeof totals.by_queue)[number]>("queue", "queue", (q) => q.queue),
    col<(typeof totals.by_queue)[number]>(
      "started",
      "runs started",
      (q) => q.started,
      { end: true },
    ),
    col<(typeof totals.by_queue)[number]>(
      "avg",
      "avg wait",
      (q) => (q.avg_wait_seconds === null ? "–" : duration(q.avg_wait_seconds)),
      { end: true },
    ),
    col<(typeof totals.by_queue)[number]>(
      "max",
      "longest wait",
      (q) => (q.max_wait_seconds === null ? "–" : duration(q.max_wait_seconds)),
      { end: true },
    ),
    col<(typeof totals.by_queue)[number]>(
      "running",
      "running now",
      (q) => live.data.queues.find((l) => l.name === q.queue)?.running ?? 0,
      { end: true },
    ),
    col<(typeof totals.by_queue)[number]>(
      "queued",
      "waiting now",
      (q) => live.data.queues.find((l) => l.name === q.queue)?.queued ?? 0,
      { end: true },
    ),
  ];
  const waitFigures = $derived<Count[]>([
    {
      key: "started",
      label: "runs started",
      value: totals.by_queue.reduce((n, q) => n + q.started, 0),
    },
    {
      key: "avg",
      label: "avg wait",
      text: duration(
        totals.by_queue.reduce(
          (n, q) => n + (q.avg_wait_seconds ?? 0) * q.started,
          0,
        ) /
          Math.max(
            1,
            totals.by_queue.reduce((n, q) => n + q.started, 0),
          ),
      ),
    },
    {
      key: "max",
      label: "longest wait",
      text: duration(
        Math.max(0, ...totals.by_queue.map((q) => q.max_wait_seconds ?? 0)),
      ),
    },
    {
      key: "unserved",
      label: "queues with no worker",
      value: unserved,
      tone: unserved ? "danger" : "muted",
    },
  ]);

  const hour = (iso: string) => new Date(iso).getHours();
  const busiest = $derived.by(() => {
    const per = new Map<number, number>();
    for (const lane of lanes)
      for (const time of lane.at)
        per.set(hour(time), (per.get(hour(time)) ?? 0) + 1);
    return [...per].sort((a, b) => b[1] - a[1])[0];
  });
  const laneColumns: Column<(typeof lanes)[number]>[] = [
    col<(typeof lanes)[number]>("job", "job", (l) => l.label),
    col<(typeof lanes)[number]>("n", "firings", (l) => l.at.length, {
      end: true,
    }),
    col<(typeof lanes)[number]>("first", "next", (l) =>
      l.at[0] ? new Date(l.at[0]).toLocaleString() : "–",
    ),
    col<(typeof lanes)[number]>("last", "last in window", (l) =>
      l.at.length ? new Date(l.at[l.at.length - 1]).toLocaleString() : "–",
    ),
  ];
  const laneFigures = $derived<Count[]>([
    { key: "firings", label: "firings", value: firings },
    { key: "jobs", label: "jobs", value: lanes.length },
    {
      key: "busiest",
      label: "busiest hour",
      text: busiest
        ? `${String(busiest[0]).padStart(2, "0")}:00 · ${busiest[1]}`
        : "–",
    },
  ]);
</script>

{#snippet runsChart()}
  <Columns rows={perDay} format={compact} legend={[...OUTCOMES]} fill />
{/snippet}
{#snippet runsTable()}
  <DataTable
    columns={runColumns}
    rows={[...perDay].reverse()}
    rowKey={(r) => r.key}
  />
{/snippet}
{#snippet queueChart()}
  <Bars
    rows={queues}
    format={duration}
    sum={false}
    onpick={() => showSection("queues")}
  />
{/snippet}
{#snippet queueDetailChart()}
  <Columns rows={waitPerDay} format={duration} fill />
{/snippet}
{#snippet queueTable()}
  <DataTable
    columns={queueColumns}
    rows={totals.by_queue}
    rowKey={(q) => q.queue}
  />
{/snippet}
{#snippet kindChart()}
  <Bars rows={byKind} format={compact} legend={[...KIND_PARTS]} />
{/snippet}
{#snippet kindTable()}
  <DataTable
    columns={kindColumns}
    rows={totals.by_kind}
    rowKey={(k) => k.kind}
  />
{/snippet}
{#snippet laneTable()}
  <DataTable columns={laneColumns} rows={lanes} rowKey={(l) => l.key} />
{/snippet}

<Overview {figures} loading={census.loading} error={census.error} cols={4}>
  <Tile
    title="runs"
    key="runs"
    meta={`${compact(shownRuns)} · ${perDay.length} d`}
    span={2}
    empty={!shownRuns}
  >
    {#snippet detail()}
      <Detail
        figures={runFigures}
        windowed
        days={totals.days}
        loading={census.loading}
        table={runsTable}
      >
        {@render runsChart()}
      </Detail>
    {/snippet}
    {@render runsChart()}
  </Tile>

  <Stack>
    <Tile title="success" meta="{totals.days} d" size="content">
      <Ratios items={success} />
    </Tile>

    <Tile
      title="queue wait"
      key="queue-wait"
      expand="list"
      meta="avg · {totals.days} d"
      empty={!queues.length}
    >
      {#snippet detail()}
        <Detail
          figures={waitFigures}
          windowed
          days={totals.days}
          loading={census.loading}
          table={queueTable}
        >
          {@render queueDetailChart()}
        </Detail>
      {/snippet}
      {@render queueChart()}
    </Tile>
  </Stack>

  <Tile
    title="runs by job"
    key="runs-by-job"
    expand="list"
    meta="{totals.days} d · avg time"
    empty={!byKind.length}
  >
    {#snippet detail()}
      <Detail
        figures={kindFigures}
        windowed
        days={totals.days}
        loading={census.loading}
        table={kindTable}
      >
        {@render kindChart()}
      </Detail>
    {/snippet}
    {@render kindChart()}
  </Tile>

  <Tile
    title="next 24 h"
    key="next-24h"
    meta={`${firings}`}
    empty={!lanes.length}
    span={4}
  >
    {#snippet detail()}
      <Detail figures={laneFigures} table={laneTable}>
        <Timeline {lanes} {from} />
      </Detail>
    {/snippet}
    <Timeline {lanes} {from} />
  </Tile>
</Overview>
