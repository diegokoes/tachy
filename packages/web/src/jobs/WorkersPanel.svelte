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

{#snippet workerName(w: JobWorkerRow)}
  <span class="mono" use:tip={`pid ${w.pid}`}>{w.host}</span>
  <span class="dim small">up {since(w.started_at)}</span>
{/snippet}

{#snippet workerQueues(w: JobWorkerRow)}
  <span class="chips">
    {#each w.queues as q (q)}<span class="chip mono">{q}</span>{/each}
  </span>
{/snippet}

{#snippet workerSlots(w: JobWorkerRow)}
  <span
    class="slots"
    use:tip={Object.keys(w.per_class).length
      ? Object.entries(w.per_class)
          .map(([c, n]) => `${n} ${c}`)
          .join(", ")
      : undefined}
  >
    <Meter
      value={w.runs.length / Math.max(1, slotsOf(w))}
      width={Math.max(1, slotsOf(w))}
      label="slots in use"
    />
    <span class="dim">{w.runs.length} of {slotsOf(w)}</span>
  </span>
{/snippet}

{#snippet workerRuns(w: JobWorkerRow)}
  {#each w.runs as r (r.id)}
    <div class="run">
      <span class="name"
        >{r.definition_name ?? r.kind_title}
        {#if r.subject}<span class="dim">{r.subject}</span>{/if}</span
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
    <span class="state danger" use:tip={`seen ${since(w.last_seen_at)} ago`}
      ><Icon name="runFailed" size="1.1em" />gone</span
    >
  {:else if w.draining}
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
