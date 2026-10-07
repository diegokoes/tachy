<script lang="ts">
  import { onMount } from "svelte";
  import { DataTable, Note, type Column } from "../tui";
  import { fmtDateTime } from "../dates.svelte";
  import { showSection } from "../admin/overview";
  import { jobs } from "./census.svelte";

  type Failure = (typeof jobs.data.failures)[number];

  // Which jobs failed, not how many runs did: the counter behind this already
  // says how many. What it cannot say is whether that is one job failing every
  // night or eight jobs failing once.
  const columns: Column<Failure>[] = [
    { key: "name", label: "job", width: "18rem", cell: nameCell },
    { key: "runs", label: "failed", width: "5rem", align: "end" },
    {
      key: "last_at",
      label: "last",
      width: "11rem",
      value: (f) => fmtDateTime(f.last_at),
    },
    { key: "last_error", label: "last error", cell: errorCell },
  ];

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

<Note>
  Failed or timed out in the last {jobs.data.days} days. Each run's log is in
  <button class="link" onclick={() => showSection("runs")}>runs</button>.
</Note>

<DataTable
  {columns}
  rows={jobs.data.failures}
  rowKey={(f) => `${f.definition_id ?? f.kind}:${f.name}`}
  loading={jobs.loading}
  error={jobs.error}
  emptyTitle="Nothing failed."
  emptyDetail={`No failed or timed-out runs in the last ${jobs.data.days} days.`}
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
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
