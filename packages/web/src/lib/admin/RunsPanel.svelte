<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { JOB_STATUSES, JOB_TRIGGERS } from "@tachy/contract";
  import { api } from "../api";
  import { keep, recall } from "../kept";
  import { createSequence, errText } from "../resource.svelte";
  import {
    Badge,
    Button,
    DataTable,
    FilterBar,
    Meter,
    Modal,
    Note,
    Select,
    Time,
    isActive,
    toneOf,
    type Column,
  } from "../tui";
  import { shadowPulse } from "../motion";
  import { duration } from "./overview";
  import type { JobKindInfo, JobRunListedRow } from "./rows";
  import { jobs as census } from "./jobCensus.svelte";

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
  $effect(() => keep("admin.runs.filter", filter));
  $effect(() => keep("admin.runs.status", status));
  $effect(() => keep("admin.runs.kind", kind));
  $effect(() => keep("admin.runs.trigger", trigger));

  const current = createSequence();

  function query(before?: string) {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (status === "active") q.set("active", "true");
    else if (status) q.set("status", status);
    if (kind) q.set("kind", kind);
    if (trigger) q.set("trigger", trigger);
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
    void [status, kind, trigger];
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
      `${r.definition_name ?? ""} ${r.kind} ${summary(r.params)} ${r.requested_by_name ?? ""} ${r.error ?? ""}`
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

  function summary(params: Record<string, unknown>) {
    return Object.entries(params)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
  }

  function elapsed(r: JobRunListedRow) {
    const from = Date.parse(r.started_at ?? r.created_at);
    const to = r.finished_at ? Date.parse(r.finished_at) : now;
    return Number.isFinite(from)
      ? duration(Math.max(0, (to - from) / 1000))
      : "";
  }

  const columns: Column<JobRunListedRow>[] = [
    { key: "status", label: "status", width: "7rem", cell: statusCell },
    { key: "job", label: "job", width: "16rem", cell: jobCell },
    { key: "trigger", label: "by", width: "9rem", cell: triggerCell },
    { key: "detail", label: "progress", cell: detailCell },
    { key: "when", label: "queued", width: "10rem", cell: whenCell },
    { key: "took", label: "took", width: "6rem", align: "end", cell: tookCell },
    { key: "acts", label: "", width: "7rem", align: "end", cell: actsCell },
  ];
</script>

{#snippet statusCell(r: JobRunListedRow)}
  {#if r.status === "running"}
    <span class="live" use:shadowPulse={{ loop: true }}
      ><Badge tone={toneOf(r.status)}>{r.status}</Badge></span
    >
  {:else}
    <Badge tone={toneOf(r.status)}>{r.status.replace("_", " ")}</Badge>
  {/if}
{/snippet}

{#snippet jobCell(r: JobRunListedRow)}
  <span class="name">{r.definition_name ?? r.kind}</span>
  <span class="dim small" title={summary(r.params)}
    >{r.definition_name ? `${r.kind} ` : ""}{summary(r.params)}</span
  >
{/snippet}

{#snippet triggerCell(r: JobRunListedRow)}
  <span>{r.trigger}</span>
  {#if r.requested_by_name}<span class="dim small">{r.requested_by_name}</span
    >{/if}
{/snippet}

{#snippet detailCell(r: JobRunListedRow)}
  {#if r.status === "running"}
    <span class="progress">
      <Meter value={r.progress ?? 0} width={12} label="progress" />
      <span class="pct">{Math.round((r.progress ?? 0) * 100)}%</span>
    </span>
    <span class="dim small">
      {r.progress_note ?? "starting"}{r.locked_by ? ` · ${r.locked_by}` : ""}
      {#if r.cancel_requested}<span class="warn"> · stopping</span>{/if}
    </span>
  {:else if r.status === "queued"}
    <span class="dim"
      >waiting{r.attempts
        ? ` to retry (attempt ${r.attempts + 1}/${r.max_attempts})`
        : ""}</span
    >
  {:else if r.error}
    <span class="err" title={r.error}>{r.error}</span>
  {:else if r.output}
    <span class="dim small" title={JSON.stringify(r.output)}
      >{summary(r.output)}</span
    >
  {/if}
{/snippet}

{#snippet whenCell(r: JobRunListedRow)}
  <Time at={r.created_at} />
{/snippet}

{#snippet tookCell(r: JobRunListedRow)}
  <span class="dim">{r.status === "queued" ? "" : elapsed(r)}</span>
{/snippet}

{#snippet actsCell(r: JobRunListedRow)}
  <span class="acts">
    {#if r.log_tail}
      <Button variant="ghost" size="sm" onclick={() => (logOf = r.id)}
        >log</Button
      >
    {/if}
    {#if isActive(r.status) && !r.cancel_requested}
      <Button
        variant="ghost"
        size="sm"
        tone="danger"
        icon="stop"
        title="stop this run; it finishes its current step first"
        onclick={() => cancel(r)}>stop</Button
      >
    {/if}
  </span>
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}

<div class="bar">
  <FilterBar
    bind:value={filter}
    shown={shown.length}
    total={rows.length}
    placeholder="filter by job, params, person or error…"
    label="filter runs"
  />
  <Select
    bind:value={status}
    options={[
      { value: "active", label: "queued or running" },
      ...JOB_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") })),
    ]}
    placeholder="any status"
    clearable
    keepOpen
    active={!!status}
    aria-label="filter by status"
  />
  <Select
    bind:value={kind}
    options={kinds.map((k) => ({ value: k.kind, label: k.kind }))}
    placeholder="any kind"
    clearable
    keepOpen
    active={!!kind}
    aria-label="filter by kind"
  />
  <Select
    bind:value={trigger}
    options={JOB_TRIGGERS.map((t) => ({ value: t, label: t }))}
    placeholder="any trigger"
    clearable
    keepOpen
    active={!!trigger}
    aria-label="filter by trigger"
  />
</div>

<DataTable
  {columns}
  rows={shown}
  rowKey={(r) => r.id}
  {loading}
  rowClass={(r) => (isActive(r.status) ? "active" : undefined)}
  emptyTitle={rows.length ? "No runs match." : "No runs yet."}
  emptyDetail="Runs come from schedules, the run button on a job, and actions elsewhere such as indexing a repo."
/>

{#if more}
  <div class="more">
    <Button variant="ghost" size="sm" onclick={older}>older runs</Button>
  </div>
{/if}

{#if logRun}
  <Modal
    title={`${logRun.definition_name ?? logRun.kind} · log`}
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
  }
  .live {
    color: var(--accent);
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
