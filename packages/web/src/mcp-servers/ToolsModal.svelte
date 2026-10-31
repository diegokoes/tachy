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
  let saving = $state(false);
  let error = $state<string | null>(null);
  /** Ticks not saved yet, by tool name; survives "list again". */
  let pending = $state<Record<string, boolean>>({});
  let expanded = $state<string | null>(null);

  const readOnly = (tool: McpServerToolRow) =>
    tool.annotations.readOnlyHint === true;
  const destructive = (tool: McpServerToolRow) =>
    tool.annotations.destructiveHint === true;
  const offered = (tool: McpServerToolRow) =>
    pending[tool.name] ?? tool.exposed;

  const changed = $derived(
    tools.data.filter(
      (tool) => tool.name in pending && pending[tool.name] !== tool.exposed,
    ),
  );

  /** Ticking a tool without readOnlyHint is the admin's word that it only reads. */
  async function save() {
    saving = true;
    error = null;
    try {
      for (const tool of changed) {
        const exposed = offered(tool);
        await api.put(
          `/mcp-servers/${server.slug}/tools/${encodeURIComponent(tool.name)}`,
          { exposed, attested: exposed && !readOnly(tool) },
        );
      }
      onclose();
    } catch (e) {
      error = errText(e);
      await tools.reload();
    } finally {
      saving = false;
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
    { key: "exposed", label: "offered", width: "5rem", cell: offeredCell },
    { key: "name", label: "tool", width: "16rem" },
    { key: "kind", label: "read-only", width: "7rem", cell: kindCell },
    {
      key: "description",
      face: "ui",
      label: "description",
      cell: descriptionCell,
      head: descriptionHead,
    },
  ];

  onMount(() => tools.reload());
</script>

{#snippet offeredCell(tool: McpServerToolRow)}
  <Checkbox
    checked={offered(tool)}
    disabled={!canChange || destructive(tool)}
    ariaLabel={`offer ${tool.name}`}
    onchange={(on) => (pending[tool.name] = on)}
  />
{/snippet}

{#snippet kindCell(tool: McpServerToolRow)}
  {#if destructive(tool)}
    <Badge tone="danger">destructive</Badge>
  {:else if readOnly(tool)}
    <Badge tone="ok">declared</Badge>
  {:else if offered(tool)}
    <Badge tone="warn">confirmed</Badge>
  {:else}
    <span class="dim">unknown</span>
  {/if}
{/snippet}

{#snippet descriptionCell(tool: McpServerToolRow)}
  <span class="desc" class:full={expanded === tool.name}
    >{tool.description}</span
  >
{/snippet}

{#snippet descriptionHead()}
  <span class="head">
    description
    {#if canChange}
      <Button
        variant="ghost"
        size="sm"
        icon="refresh"
        busy={refreshing}
        onclick={refresh}>list again</Button
      >
    {/if}
  </span>
{/snippet}

<Modal
  title={`tools: ${server.name}`}
  width="64rem"
  confirmLabel="save"
  busy={saving}
  onConfirm={canChange ? save : undefined}
  cancelLabel={canChange ? "cancel" : "close"}
  onCancel={onclose}
>
  {#if error}<Note tone="warn">{error}</Note>{/if}
  <DataTable
    {columns}
    rows={tools.data}
    rowKey={(tool) => tool.name}
    loading={tools.loading}
    error={tools.error}
    emptyTitle="no tools listed yet"
    emptyDetail="save a token, then list the server's tools"
    onrowclick={(tool) =>
      (expanded = expanded === tool.name ? null : tool.name)}
  />
</Modal>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pad-2);
  }
  /* The header's caps and tracking are for the label, not the button. */
  .head :global(.btn) {
    text-transform: none;
    letter-spacing: normal;
  }
  .desc {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .desc.full {
    white-space: normal;
    padding: var(--pad-1) 0;
  }
  .dim {
    color: var(--muted);
  }
</style>
