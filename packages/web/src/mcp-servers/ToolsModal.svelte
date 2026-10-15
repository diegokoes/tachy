<script lang="ts">
  import { onMount } from "svelte";
  import type { McpServerRow, McpServerToolRow } from "@tachy/contract";
  import { api } from "../api";
  import { createResource, errText } from "../resource.svelte";
  import {
    Badge,
    Button,
    Checkbox,
    DataTable,
    Modal,
    Note,
    type Column,
  } from "../tui";

  let {
    server,
    canChange,
    onclose,
  }: {
    server: McpServerRow;
    canChange: boolean;
    onclose: () => void;
  } = $props();

  const tools = createResource(
    () => api.get<McpServerToolRow[]>(`/mcp-servers/${server.slug}/tools`),
    [],
  );

  let refreshing = $state(false);
  let error = $state<string | null>(null);
  // A tool without readOnlyHint takes a second click confirming it only reads.
  let confirming = $state<string | null>(null);

  const readOnly = (tool: McpServerToolRow) =>
    tool.annotations.readOnlyHint === true;
  const destructive = (tool: McpServerToolRow) =>
    tool.annotations.destructiveHint === true;

  async function setExposed(tool: McpServerToolRow, exposed: boolean) {
    if (exposed && !readOnly(tool) && confirming !== tool.name) {
      confirming = tool.name;
      return;
    }
    error = null;
    confirming = null;
    try {
      await tools.mutate(() =>
        api.put(
          `/mcp-servers/${server.slug}/tools/${encodeURIComponent(tool.name)}`,
          {
            exposed,
            attested: exposed && !readOnly(tool),
          },
        ),
      );
    } catch (e) {
      error = errText(e);
    }
  }

  async function refresh() {
    refreshing = true;
    error = null;
    try {
      await tools.mutate(() =>
        api.post(`/mcp-servers/${server.slug}/refresh`, {}),
      );
    } catch (e) {
      error = errText(e);
    } finally {
      refreshing = false;
    }
  }

  const columns: Column<McpServerToolRow>[] = [
    { key: "exposed", label: "offered", width: "6rem", cell: exposedCell },
    { key: "name", label: "tool", width: "16rem" },
    { key: "kind", label: "says", width: "8rem", cell: kindCell },
    { key: "description", label: "description" },
  ];

  onMount(() => tools.reload());
</script>

{#snippet exposedCell(tool: McpServerToolRow)}
  {#if confirming === tool.name}
    <Button
      size="sm"
      tone="warn"
      icon="confirm"
      onclick={() => setExposed(tool, true)}>only reads</Button
    >
  {:else}
    <Checkbox
      checked={tool.exposed}
      disabled={!canChange || destructive(tool)}
      ariaLabel={`offer ${tool.name}`}
      onchange={(on) => setExposed(tool, on)}
    />
  {/if}
{/snippet}

{#snippet kindCell(tool: McpServerToolRow)}
  {#if destructive(tool)}
    <Badge tone="danger">destructive</Badge>
  {:else if readOnly(tool)}
    <Badge tone="ok">reads</Badge>
  {:else if tool.attested_by}
    <Badge tone="warn">vouched</Badge>
  {:else}
    <Badge tone="warn">no hint</Badge>
  {/if}
{/snippet}

<Modal
  title={`tools: ${server.name}`}
  width="64rem"
  confirmLabel="done"
  confirmIcon="confirm"
  onConfirm={onclose}
  onCancel={onclose}
>
  <Note>
    Offered tools run in chat without review, so only tools that read can be
    offered. A tool that does not say it reads needs your confirmation that it
    does; a destructive one is never offered.
  </Note>
  {#if canChange}
    <div class="bar">
      <Button
        variant="ghost"
        size="sm"
        icon="refresh"
        busy={refreshing}
        onclick={refresh}>list again</Button
      >
    </div>
  {/if}
  {#if error}<Note tone="warn">{error}</Note>{/if}
  <DataTable
    {columns}
    rows={tools.data}
    rowKey={(tool) => tool.name}
    loading={tools.loading}
    error={tools.error}
    emptyTitle="No tools listed yet."
    emptyDetail="Save a token, then list the server's tools."
  />
</Modal>

<style>
  .bar {
    display: flex;
    justify-content: flex-end;
    margin: var(--pad-2) 0;
  }
</style>
