<script lang="ts">
  import { onMount } from "svelte";
  import { DataTable, Note, type Column } from "../tui";
  import { fmtDateTime } from "../dates";
  import { showSection } from "./overview";
  import { jobs } from "./jobCensus.svelte";

  type Failure = (typeof jobs.data.failures)[number];

  /* Which jobs failed, not how many runs did: the counter behind this already
     says how many. What it cannot say is whether that is one job failing
     every night or eight jobs failing once. */
  const columns: Column<Failure>[] = [
    { key: "name", label: "job", width: "14rem" },
    { key: "kind", label: "kind", width: "11rem" },
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

{#snippet errorCell(f: Failure)}
  {#if f.last_error}
    <span class="err" title={f.last_error}>{f.last_error}</span>
  {:else}
    <span class="dim">no message</span>
  {/if}
{/snippet}

<Note>
  Failed or timed out in the last {jobs.data.days} days. The logs are on each
  job's history, in
  <button class="link" onclick={() => showSection("jobs")}>jobs</button>.
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
