<script lang="ts">
  import { DataTable, Icon, Meter, Note, tip, type Column } from "../tui";
  import { duration } from "../admin/overview";
  import type { JobWorkerRow } from "@tachy/contract";
  import { followLive, live } from "./live.svelte";

  followLive();

  const since = (iso: string | null) =>
    iso ? duration(Math.max(0, (Date.now() - Date.parse(iso)) / 1000)) : "";

  const slotsOf = (w: JobWorkerRow) => w.concurrency;

  const workerColumns: Column<JobWorkerRow>[] = [
    { key: "worker", label: "worker", width: "14rem", cell: workerName },
    { key: "queues", label: "takes from", width: "16rem", cell: workerQueues },
    { key: "slots", label: "busy", width: "8rem", cell: workerSlots },
    { key: "runs", label: "working on", cell: workerRuns },
    { key: "seen", label: "status", width: "8rem", cell: workerState },
  ];
</script>

{#snippet workerName(worker: JobWorkerRow)}
  <span class="mono" use:tip={`pid ${worker.pid}`}>{worker.host}</span>
  <span class="dim small">up {since(worker.started_at)}</span>
{/snippet}

{#snippet workerQueues(worker: JobWorkerRow)}
  <span class="chips">
    {#each worker.queues as queue (queue)}<span class="chip mono">{queue}</span
      >{/each}
  </span>
{/snippet}

{#snippet workerSlots(worker: JobWorkerRow)}
  <span
    class="slots"
    use:tip={Object.keys(worker.per_class).length
      ? Object.entries(worker.per_class)
          .map(([c, n]) => `${n} ${c}`)
          .join(", ")
      : undefined}
  >
    <Meter
      value={worker.runs.length / Math.max(1, slotsOf(worker))}
      width={Math.max(1, slotsOf(worker))}
      label="slots in use"
    />
    <span class="dim">{worker.runs.length} of {slotsOf(worker)}</span>
  </span>
{/snippet}

{#snippet workerRuns(worker: JobWorkerRow)}
  {#each worker.runs as run (run.id)}
    <div class="run">
      <span class="name"
        >{run.definition_name ?? run.kind_title}
        {#if run.subject}<span class="dim">{run.subject}</span>{/if}</span
      >
      <span class="progress">
        <Meter value={run.progress ?? 0} width={8} label="progress" />
        <span class="dim small"
          >{Math.round((run.progress ?? 0) * 100)}%{run.progress_note
            ? ` · ${run.progress_note}`
            : ""}</span
        >
      </span>
    </div>
  {:else}
    <span class="dim">idle</span>
  {/each}
{/snippet}

{#snippet workerState(worker: JobWorkerRow)}
  {#if !worker.alive}
    <span
      class="state danger"
      use:tip={`seen ${since(worker.last_seen_at)} ago`}
      ><Icon name="runFailed" size="1.1em" />gone</span
    >
  {:else if worker.draining}
    <span class="state warn"><Icon name="pause" size="1.1em" />draining</span>
  {:else}
    <span class="state ok"><Icon name="success" size="1.1em" />live</span>
  {/if}
{/snippet}

<div class="workers">
  {#if live.error}<Note tone="danger">{live.error}</Note>{/if}

  <DataTable
    columns={workerColumns}
    rows={live.data.workers}
    rowKey={(w) => w.id}
    loading={live.loading && !live.data.workers.length}
    rowClass={(w) => (w.alive ? undefined : "gone")}
    emptyTitle="No worker is running."
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
  .workers :global(tr.gone) {
    opacity: 0.55;
  }
  .slots {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
  }
  .state.ok {
    color: var(--ok);
  }
  .state.warn {
    color: var(--warn);
  }
  .state.danger {
    color: var(--danger);
  }
</style>
