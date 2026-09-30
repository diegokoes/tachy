<script lang="ts">
  import { Badge, DataTable, Meter, Note, type Column } from "../tui";
  import { duration, showSection } from "./overview";
  import type { JobLive, JobWorkerRow } from "./rows";
  import { followLive, live } from "./jobLive.svelte";

  type Queue = JobLive["queues"][number];

  followLive();

  const since = (iso: string | null) =>
    iso ? duration(Math.max(0, (Date.now() - Date.parse(iso)) / 1000)) : "";

  const params = (p: Record<string, unknown>) =>
    Object.values(p)
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join(" ");

  const slotsOf = (w: JobWorkerRow) => w.concurrency;

  const unserved = $derived(
    live.data.queues.filter((q) => q.queued > 0 && q.workers === 0),
  );

  const queueColumns: Column<Queue>[] = [
    { key: "name", label: "queue", width: "9rem", cell: queueName },
    { key: "running", label: "running", width: "9rem", cell: queueRunning },
    { key: "queued", label: "waiting", width: "9rem", cell: queueWaiting },
    { key: "served", label: "served by", cell: queueServed },
  ];

  const workerColumns: Column<JobWorkerRow>[] = [
    { key: "worker", label: "worker", width: "14rem", cell: workerName },
    { key: "queues", label: "queues", width: "14rem", cell: workerQueues },
    { key: "slots", label: "slots", width: "8rem", cell: workerSlots },
    { key: "runs", label: "working on", cell: workerRuns },
    { key: "seen", label: "state", width: "8rem", cell: workerState },
  ];
</script>

{#snippet queueName(q: Queue)}
  <span class="mono">{q.name}</span>
  <span class="dim small">{q.class} pool</span>
{/snippet}

{#snippet queueRunning(q: Queue)}
  {q.running}{#if q.cap}<span class="dim"> / {q.cap} at most</span>{/if}
{/snippet}

{#snippet queueWaiting(q: Queue)}
  {#if q.queued}
    {q.queued}
    <span class="dim small">oldest {since(q.oldest_queued_at)}</span>
  {:else}
    <span class="dim">0</span>
  {/if}
{/snippet}

{#snippet queueServed(q: Queue)}
  {#if q.workers}
    {q.workers}
    {q.workers === 1 ? "worker" : "workers"}
    <span class="dim">· {q.slots} {q.slots === 1 ? "slot" : "slots"}</span>
  {:else}
    <Badge tone={q.queued ? "danger" : "muted"}>no worker</Badge>
  {/if}
{/snippet}

{#snippet workerName(w: JobWorkerRow)}
  <span class="mono">{w.host}</span>
  <span class="dim small" title={w.id}
    >pid {w.pid} · up {since(w.started_at)}</span
  >
{/snippet}

{#snippet workerQueues(w: JobWorkerRow)}
  <span class="chips">
    {#each w.queues as q (q)}<span class="chip mono">{q}</span>{/each}
  </span>
{/snippet}

{#snippet workerSlots(w: JobWorkerRow)}
  <Meter
    value={w.runs.length / Math.max(1, slotsOf(w))}
    width={Math.max(1, slotsOf(w))}
    label="slots in use"
  />
  <span class="dim small">
    {w.runs.length}/{slotsOf(w)}{Object.keys(w.per_class).length
      ? ` · ${Object.entries(w.per_class)
          .map(([c, n]) => `${n} ${c}`)
          .join(", ")}`
      : ""}
  </span>
{/snippet}

{#snippet workerRuns(w: JobWorkerRow)}
  {#each w.runs as r (r.id)}
    <div class="run">
      <span class="name" title={params(r.params)}
        >{r.definition_name ?? r.kind}
        <span class="dim">{params(r.params)}</span></span
      >
      <span class="progress">
        <Meter value={r.progress ?? 0} width={8} label="progress" />
        <span class="dim small"
          >{Math.round((r.progress ?? 0) * 100)}%{r.progress_note
            ? ` · ${r.progress_note}`
            : ""}</span
        >
      </span>
    </div>
  {:else}
    <span class="dim">idle</span>
  {/each}
{/snippet}

{#snippet workerState(w: JobWorkerRow)}
  {#if !w.alive}
    <Badge tone="danger">gone</Badge>
    <span class="dim small">seen {since(w.last_seen_at)} ago</span>
  {:else if w.draining}
    <Badge tone="warn">draining</Badge>
  {:else}
    <Badge tone="ok">live</Badge>
  {/if}
{/snippet}

<div class="workers">
  {#if live.error}<Note tone="danger">{live.error}</Note>{/if}
  {#if unserved.length}
    <Note tone="danger">
      {unserved.map((q) => q.name).join(", ")}
      {unserved.length === 1 ? "has" : "have"} runs waiting and no live worker serving
      {unserved.length === 1 ? "it" : "them"}. Check that the worker services
      are up, or that TACHY_WORKER_QUEUES leaves none out.
    </Note>
  {/if}

  <h3>queues</h3>
  <DataTable
    columns={queueColumns}
    rows={live.data.queues}
    rowKey={(q) => q.name}
    loading={live.loading && !live.data.queues.length}
    rowClass={(q) => (q.queued && !q.workers ? "unserved" : undefined)}
    emptyTitle="No queues."
  />

  <h3>workers</h3>
  <DataTable
    columns={workerColumns}
    rows={live.data.workers}
    rowKey={(w) => w.id}
    loading={live.loading && !live.data.workers.length}
    rowClass={(w) => (w.alive ? undefined : "gone")}
    emptyTitle="No worker is running."
    emptyDetail="Runs wait in their queues until a worker claims them. The API works every queue itself unless TACHY_WORKER=external."
  />

  <p class="dim small foot">
    Each worker claims from its queues, most urgent first. Its runs, their logs
    and history are in <button class="link" onclick={() => showSection("runs")}
      >runs</button
    >.
  </p>
</div>

<style>
  h3 {
    margin: var(--pad-4) 0 var(--pad-2);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .dim {
    color: var(--muted);
  }
  .small {
    display: block;
    font-size: var(--fs-xs);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
  }
  .chip {
    font-size: var(--fs-xs);
    padding: 0 var(--pad-1);
    border: 1px solid var(--border);
  }
  .run + .run {
    margin-top: var(--pad-1);
  }
  .run .name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .progress {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .foot {
    margin-top: var(--pad-3);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  .workers :global(tr.gone) {
    opacity: 0.55;
  }
  .workers :global(tr.unserved) {
    color: var(--danger);
  }
</style>
