<script lang="ts">
  import { onMount } from "svelte";
  import { DataTable, type Column } from "../tui";
  import { fmtDateTime } from "../dates.svelte";
  import { jobs } from "./census.svelte";

  type Failure = (typeof jobs.data.failures)[number];

  // Which jobs failed, not how many runs did: the counter behind this already
  // says how many. What it cannot say is whether that is one job failing every
  // night or eight jobs failing once.
  const columns: Column<Failure>[] = $derived([
    { key: "name", label: "job", width: "18rem", cell: nameCell },
    {
      key: "runs",
      label: `failed · ${jobs.data.days} d`,
      width: "7rem",
      align: "end",
    },
    {
      key: "last_at",
      label: "last",
      width: "11rem",
      value: (f) => fmtDateTime(f.last_at),
    },
    { key: "last_error", label: "last error", cell: errorCell },
  ]);

  onMount(() => void jobs.reload());
</script>

{#snippet nameCell(failure: Failure)}
  {failure.definition_id ? failure.name : failure.title}
  {#if failure.definition_id && failure.name !== failure.title}
    <span class="dim small">{failure.title}</span>
  {/if}
{/snippet}

{#snippet errorCell(failure: Failure)}
  {#if failure.last_error}
    <span class="err">{failure.last_error}</span>
  {:else}
    <span class="dim">no message</span>
  {/if}
{/snippet}

<DataTable
  {columns}
  rows={jobs.data.failures}
  rowKey={(f) => `${f.definition_id ?? f.kind}:${f.name}`}
  loading={jobs.loading}
  error={jobs.error}
  emptyTitle="nothing failed"
  emptyDetail={`no failed or timed-out runs in the last ${jobs.data.days} days`}
/>

<style>
  .err {
    display: block;
    color: var(--danger);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
  }
  .dim {
    color: var(--muted);
  }
  .small {
    display: block;
    font-size: var(--fs-xs);
  }
</style>
