<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { JOB_QUEUES, JOB_STATUSES } from "@tachy/contract";
  import { api } from "../api";
  import { keep, recall } from "../shell/kept";
  import { createSequence, errText } from "../resource.svelte";
  import {
    Button,
    DataTable,
    FilterBar,
    Icon,
    Meter,
    Modal,
    Note,
    Select,
    Time,
    isActive,
    tip,
    type Column,
  } from "../tui";
  import { duration } from "../admin/overview";
  import {
    STATUS_MARK,
    hasLog,
    startedBy,
    statusMark,
    waitingText,
  } from "./status";
  import type { JobKindInfo, JobRunListedRow } from "./rows";
  import { jobs as census } from "./census.svelte";

  const PAGE = 100;
  const ACTIVE_MS = 3_000;
  const IDLE_MS = 15_000;

  let rows = $state<JobRunListedRow[]>([]);
  let kinds = $state<JobKindInfo[]>([]);
  let loading = $state(true);
  let more = $state(false);
  let error = $state<string | null>(null);
  let now = $state(Date.now());
  let logOf = $state<string | null>(null);

  let filter = $state(recall("admin.runs.filter", ""));
  let status = $state(recall("admin.runs.status", ""));
  let kind = $state(recall("admin.runs.kind", ""));
  let trigger = $state(recall("admin.runs.trigger", ""));
  let queue = $state(recall("admin.runs.queue", ""));
  /** The run whose children are shown; not kept, since it is a drill-down. */
  let parent = $state<JobRunListedRow | null>(null);
  $effect(() => keep("admin.runs.filter", filter));
  $effect(() => keep("admin.runs.status", status));
  $effect(() => keep("admin.runs.kind", kind));
  $effect(() => keep("admin.runs.trigger", trigger));
  $effect(() => keep("admin.runs.queue", queue));

  const current = createSequence();

  function query(before?: string) {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (status === "active") q.set("active", "true");
    else if (status) q.set("status", status);
    if (kind) q.set("kind", kind);
    if (trigger) q.set("trigger", trigger);
    if (queue) q.set("queue", queue);
    if (parent) q.set("parent_id", parent.id);
    if (before) q.set("before", before);
    return `/jobs/runs?${q}`;
  }

  /* A refresh replaces the newest page and keeps the older pages loaded
     below it, so following live runs does not collapse a list read further down. */
  async function load() {
    const isCurrent = current();
    try {
      const page = await api.get<JobRunListedRow[]>(query());
      if (!isCurrent()) return;
      const at = page.length === PAGE ? page.at(-1)!.id : null;
      const cut = at ? rows.findIndex((r) => r.id === at) : -1;
      const kept = cut >= 0 ? rows.slice(cut + 1) : [];
      if (!kept.length) more = page.length === PAGE;
      rows = [...page, ...kept];
      error = null;
    } catch (e) {
      if (isCurrent()) error = errText(e);
    } finally {
      if (isCurrent()) loading = false;
      now = Date.now();
    }
  }

  async function older() {
    const last = rows.at(-1);
    if (!last) return;
    try {
      const page = await api.get<JobRunListedRow[]>(query(last.id));
      rows = [...rows, ...page];
      more = page.length === PAGE;
    } catch (e) {
      error = errText(e);
    }
  }

  $effect(() => {
    void [status, kind, trigger, queue, parent];
    rows = [];
    loading = true;
    void load();
  });

  async function cancel(r: JobRunListedRow) {
    error = null;
    try {
      await api.post(`/jobs/runs/${r.id}/cancel`, {});
      await load();
      void census.reload();
    } catch (e) {
      error = errText(e);
    }
  }

  const shown = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.definition_name ?? ""} ${titleOf(r.kind)} ${r.subject ?? ""} ${startedBy(r, titleOf).who} ${r.outcome ?? ""} ${r.error ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  });

  const active = $derived(rows.some((r) => isActive(r.status)));
  const logRun = $derived(rows.find((r) => r.id === logOf) ?? null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    timer = setTimeout(
      async () => {
        await load();
        schedule();
      },
      active ? ACTIVE_MS : IDLE_MS,
    );
  }
  onMount(() => {
    api
      .get<{ kinds: JobKindInfo[] }>("/jobs/kinds")
      .then((k) => (kinds = k.kinds))
      .catch(() => {});
    schedule();
  });
  onDestroy(() => clearTimeout(timer));

  const titleOf = (kind: string) =>
    kinds.find((k) => k.kind === kind)?.title ?? kind;
  const nameOf = (r: JobRunListedRow) => r.definition_name ?? titleOf(r.kind);

  function elapsed(r: JobRunListedRow) {
    if (!r.started_at) return "";
    const from = Date.parse(r.started_at);
    const to = r.finished_at ? Date.parse(r.finished_at) : now;
    return Number.isFinite(from)
      ? duration(Math.max(0, (to - from) / 1000))
      : "";
  }

  const columns: Column<JobRunListedRow>[] = [
    { key: "status", label: "", width: "2.5rem", cell: statusCell },
    { key: "job", label: "job", width: "22%", cell: jobCell },
    { key: "by", label: "started by", width: "20%", cell: byCell },
    { key: "result", label: "result", cell: resultCell },
    {
      key: "took",
      label: "took",
      width: "4.5rem",
      align: "end",
      cell: tookCell,
    },
    { key: "acts", label: "", width: "5.5rem", align: "end", cell: actsCell },
  ];
</script>

{#snippet statusCell(r: JobRunListedRow)}
  {@const m = statusMark(r.status)}
  <span
    class="mark {m.tone}"
    class:spin={r.status === "running"}
    use:tip={m.label}
  >
    <Icon name={m.icon} size="1.25em" label={m.label} />
  </span>
{/snippet}

{#snippet jobCell(r: JobRunListedRow)}
  <span class="name">{nameOf(r)}</span>
  {#if r.definition_name && r.definition_name !== titleOf(r.kind)}
    <span class="dim small"
      >{titleOf(r.kind)}{r.subject ? ` · ${r.subject}` : ""}</span
    >
  {:else if r.subject}
    <span class="dim small">{r.subject}</span>
  {/if}
{/snippet}

{#snippet byCell(r: JobRunListedRow)}
  {@const by = startedBy(r, titleOf)}
  <span class="name by"
    ><Icon name={by.icon} size="1.1em" /><span>{by.who}</span></span
  >
  <span class="dim small"><Time at={r.created_at} /></span>
{/snippet}

{#snippet resultCell(r: JobRunListedRow)}
  {#if r.children}
    {@const c = r.children}
    <button class="link" onclick={() => (parent = r)}>
      {c.succeeded + c.failed} of {c.total} done{c.running
        ? ` · ${c.running} running`
        : ""}{c.failed ? ` · ${c.failed} failed` : ""}
    </button>
  {/if}
  {#if r.status === "running"}
    <span class="progress">
      <Meter value={r.progress ?? 0} width={12} label="progress" />
      <span class="pct">{Math.round((r.progress ?? 0) * 100)}%</span>
    </span>
    <span class="dim small" use:tip={r.locked_by ?? undefined}>
      {r.progress_note ?? "starting"}
      {#if r.cancel_requested}<span class="warn"> · stopping</span>{/if}
    </span>
  {:else if r.status === "queued"}
    <span class="dim">{waitingText(r, now)}</span>
  {:else if r.error}
    <span class="err">{r.error}</span>
  {:else if r.outcome}
    <span class="small">{r.outcome}</span>
  {:else if r.status === "cancelled"}
    <span class="dim">stopped</span>
  {/if}
{/snippet}

{#snippet tookCell(r: JobRunListedRow)}
  <span class="dim took">{elapsed(r)}</span>
{/snippet}

<!-- Both slots are always there, so stop stays under stop whether or not a
     run has a log worth opening. -->
{#snippet actsCell(r: JobRunListedRow)}
  <span class="acts">
    <span class="slot">
      {#if hasLog(r.log_tail)}
        <Button
          variant="ghost"
          square
          iconSize="1.2em"
          icon="file"
          title="log"
          aria-label={`log of ${nameOf(r)}`}
          onclick={() => (logOf = r.id)}
        />
      {/if}
    </span>
    <span class="slot">
      {#if isActive(r.status) && !r.cancel_requested}
        <Button
          variant="ghost"
          square
          iconSize="1.2em"
          icon="stop"
          tone="danger"
          title="stop; a running run finishes its current step first"
          aria-label={`stop ${nameOf(r)}`}
          onclick={() => cancel(r)}
        />
      {/if}
    </span>
  </span>
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}

<div class="bar">
  <FilterBar
    bind:value={filter}
    shown={shown.length}
    total={rows.length}
    label="search runs"
  />
  <Select
    bind:value={status}
    options={[
      { value: "active", label: "waiting or running" },
      ...JOB_STATUSES.map((s) => ({ value: s, label: STATUS_MARK[s].label })),
    ]}
    placeholder="any status"
    clearable
    keepOpen
    active={!!status}
    aria-label="filter by status"
  />
  <Select
    bind:value={kind}
    options={kinds.map((k) => ({ value: k.kind, label: k.title }))}
    placeholder="any job"
    clearable
    keepOpen
    active={!!kind}
    aria-label="filter by job"
  />
  <Select
    bind:value={queue}
    options={JOB_QUEUES.map((q) => ({
      value: q.name,
      label: q.name,
      hint: q.class,
    }))}
    placeholder="any queue"
    clearable
    keepOpen
    active={!!queue}
    aria-label="filter by queue"
  />
  <Select
    bind:value={trigger}
    options={[
      { value: "schedule", label: "schedule" },
      { value: "manual", label: "a person" },
      { value: "event", label: "an event" },
    ]}
    placeholder="started by"
    clearable
    keepOpen
    active={!!trigger}
    aria-label="filter by who started it"
  />
</div>

{#if parent}
  <Note>
    Runs queued by {nameOf(parent)}, started
    <Time at={parent.created_at} />.
    <button class="link" onclick={() => (parent = null)}>show all runs</button>
  </Note>
{/if}

<DataTable
  {columns}
  rows={shown}
  rowKey={(r) => r.id}
  {loading}
  rowClass={(r) => (isActive(r.status) ? "active" : undefined)}
  emptyTitle={rows.length ? "No runs match." : "No runs yet."}
/>

{#if more}
  <div class="more">
    <Button variant="ghost" size="sm" onclick={older}>older runs</Button>
  </div>
{/if}

{#if logRun}
  <Modal
    title={`${nameOf(logRun)} · log`}
    width="56rem"
    cancelLabel="close"
    onCancel={() => (logOf = null)}
  >
    <pre class="log">{logRun.log_tail}</pre>
  </Modal>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
  }
  .bar > :global(:first-child) {
    flex: 1;
  }
  .name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dim {
    color: var(--muted);
  }
  .small {
    display: block;
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .progress {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    max-width: 100%;
    overflow: hidden;
  }
  .took {
    white-space: nowrap;
  }
  .pct {
    font-variant-numeric: tabular-nums;
  }
  .err {
    display: block;
    color: var(--danger);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
  }
  .warn {
    color: var(--warn);
  }
  .acts {
    display: inline-flex;
    gap: var(--pad-1);
    white-space: nowrap;
  }
  .slot {
    display: inline-flex;
    justify-content: center;
    min-width: var(--control-h);
  }
  .mark {
    display: inline-flex;
    color: var(--muted);
  }
  .mark.ok {
    color: var(--ok);
  }
  .mark.danger {
    color: var(--danger);
  }
  .mark.accent {
    color: var(--accent);
  }
  .mark.spin :global(svg) {
    animation: spin 1.4s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mark.spin :global(svg) {
      animation: none;
    }
  }
  .by {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .by span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .link {
    display: block;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  .more {
    display: flex;
    justify-content: center;
    margin-top: var(--pad-3);
  }
  .log {
    max-height: 60vh;
    overflow: auto;
    margin: 0;
    padding: var(--pad-2);
    border: 1px dashed var(--border);
    white-space: pre-wrap;
    font-size: 0.85em;
  }
</style>
