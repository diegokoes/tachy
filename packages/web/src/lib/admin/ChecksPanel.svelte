<script lang="ts">
  import { onMount } from "svelte";
  import { Badge, Button, DataTable, Note, toneOf, type Column } from "../tui";
  import { probes, probeTally, runProbes, type Probe } from "./systemState.svelte";

  const tally = $derived(probeTally(probes.checks));

  const columns: Column<Probe>[] = [
    { key: "name", label: "check", width: "14rem" },
    { key: "state", label: "", width: "6rem", cell: stateCell },
    { key: "detail", label: "detail", cell: detailCell },
  ];

  /* Run once on opening if nothing has been run this visit. Not on every
     open: a source probe is a call to someone else's API. */
  onMount(() => {
    if (!probes.checks && !probes.running) void runProbes();
  });
</script>

{#snippet stateCell(p: Probe)}
  <Badge tone={toneOf(p.state)}>{p.state}</Badge>
{/snippet}

{#snippet detailCell(p: Probe)}
  <span class="detail" title={p.detail}>{p.detail}</span>
{/snippet}

<div class="bar">
  <Button
    variant="ghost"
    size="sm"
    icon="test"
    busy={probes.running}
    onclick={runProbes}>run checks</Button
  >
  {#if tally}
    <span class="dim">
      {tally.passing} passing{tally.warning ? ` · ${tally.warning} warning` : ""}{tally.failing
        ? ` · ${tally.failing} failing`
        : ""}{tally.skipped ? ` · ${tally.skipped} skipped` : ""}
      {#if probes.at}· {new Date(probes.at).toLocaleTimeString()}{/if}
    </span>
  {/if}
</div>

{#if probes.error}<Note tone="danger">{probes.error}</Note>{/if}

<DataTable
  {columns}
  rows={probes.checks ?? []}
  rowKey={(p) => p.name}
  loading={probes.running}
  emptyTitle="Not run yet."
  emptyDetail="Run the checks to probe this deployment."
/>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
    margin: var(--pad-2) 0;
  }
  .dim {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .detail {
    display: block;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
