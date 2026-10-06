<script lang="ts">
  import { jobQueue, type JobLive } from "@tachy/contract";
  import { Badge, DataTable, Meter, Note, tip, type Column } from "../tui";
  import { duration } from "../admin/overview";
  import { followLive, live } from "./live.svelte";

  type Queue = JobLive["queues"][number];

  followLive();

  const since = (iso: string | null) =>
    iso ? duration(Math.max(0, (Date.now() - Date.parse(iso)) / 1000)) : "";

  const unserved = $derived(
    live.data.queues.filter((q) => q.queued > 0 && q.workers === 0),
  );

  const columns: Column<Queue>[] = [
    { key: "name", label: "queue", width: "22rem", cell: nameCell },
    { key: "running", label: "running", width: "10rem", cell: runningCell },
    { key: "queued", label: "waiting", width: "10rem", cell: waitingCell },
    { key: "served", label: "served by", cell: servedCell },
  ];
</script>

{#snippet nameCell(q: Queue)}
  <span class="mono" use:tip={`${q.class} pool`}>{q.name}</span>
  <span class="dim small">{jobQueue(q.name).description}</span>
{/snippet}

{#snippet runningCell(q: Queue)}
  {#if q.cap}
    <span class="slots">
      <Meter value={q.running / q.cap} width={q.cap} label="running" />
      <span>{q.running} of {q.cap}</span>
    </span>
  {:else}
    {q.running}
  {/if}
{/snippet}

{#snippet waitingCell(q: Queue)}
  {#if q.queued}
    {q.queued}
    <span class="dim small">oldest {since(q.oldest_queued_at)}</span>
  {:else}
    <span class="dim">0</span>
  {/if}
{/snippet}

{#snippet servedCell(q: Queue)}
  {#if q.workers}
    {q.workers}
    {q.workers === 1 ? "worker" : "workers"}
    <span class="dim">· {q.slots} {q.slots === 1 ? "slot" : "slots"}</span>
  {:else}
    <Badge tone={q.queued ? "danger" : "muted"}>no worker</Badge>
  {/if}
{/snippet}

<div class="queues">
  {#if live.error}<Note tone="danger">{live.error}</Note>{/if}
  {#if unserved.length}
    <Note tone="danger">
      {unserved.map((q) => q.name).join(", ")}
      {unserved.length === 1 ? "has" : "have"} runs waiting and no live worker serving
      {unserved.length === 1 ? "it" : "them"}. Check that the worker services
      are up, or that TACHY_WORKER_QUEUES leaves none out.
    </Note>
  {/if}

  <DataTable
    {columns}
    rows={live.data.queues}
    rowKey={(q) => q.name}
    loading={live.loading && !live.data.queues.length}
    rowClass={(q) => (q.queued && !q.workers ? "unserved" : undefined)}
    emptyTitle="No queues."
  />
</div>

<style>
  .mono {
    font-family: var(--font-mono);
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
  .slots {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .queues :global(tr.unserved) {
    color: var(--danger);
  }
</style>
