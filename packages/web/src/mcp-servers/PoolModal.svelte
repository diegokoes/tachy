<script lang="ts">
  import { onMount } from "svelte";
  import {
    POOL_LABEL_RE,
    type McpPoolCredential,
    type McpServerRow,
  } from "@tachy/contract";
  import { api } from "../api";
  import { createResource, errText } from "../resource.svelte";
  import {
    Badge,
    Button,
    DataTable,
    DeleteButton,
    Modal,
    Note,
    Time,
    type Column,
  } from "../tui";

  let { server, onclose }: { server: McpServerRow; onclose: () => void } =
    $props();

  const pool = createResource(
    () =>
      api.get<McpPoolCredential[]>(`/mcp-servers/${server.slug}/credentials`),
    [],
  );

  let label = $state("");
  let value = $state("");
  let error = $state<string | null>(null);
  let saving = $state(false);

  const labelOk = $derived(POOL_LABEL_RE.test(label.trim()));

  async function add() {
    if (!labelOk || !value.trim()) return;
    saving = true;
    error = null;
    try {
      await pool.mutate(() =>
        api.put(`/mcp-servers/${server.slug}/credentials/${label.trim()}`, {
          value: value.trim(),
        }),
      );
      label = "";
      value = "";
    } catch (e) {
      error = errText(e);
    } finally {
      saving = false;
    }
  }

  const columns: Column<McpPoolCredential>[] = [
    { key: "label", label: "label", width: "10rem" },
    { key: "usage", label: "this window", cell: usageCell },
    {
      key: "cooling_until",
      label: "rests until",
      width: "11rem",
      cell: restCell,
    },
    { key: "updated_at", label: "saved", width: "11rem", cell: savedCell },
    { key: "remove", label: "", width: "3rem", cell: removeCell },
  ];

  onMount(() => pool.reload());
</script>

{#snippet usageCell(credential: McpPoolCredential)}
  {#each credential.usage as window (window.seconds)}
    <Badge tone={window.calls >= window.limit ? "warn" : undefined}
      >{window.calls}/{window.limit} per {window.seconds}s</Badge
    >
  {:else}
    <span class="dim">no budget set</span>
  {/each}
{/snippet}

{#snippet restCell(credential: McpPoolCredential)}
  {#if credential.cooling_until}<Time
      at={credential.cooling_until}
    />{:else}-{/if}
{/snippet}

{#snippet savedCell(credential: McpPoolCredential)}
  <Time at={credential.updated_at} />
{/snippet}

{#snippet removeCell(credential: McpPoolCredential)}
  <DeleteButton
    label={`remove ${credential.label}`}
    onclick={() =>
      pool.mutate(() =>
        api.delete(
          `/mcp-servers/${server.slug}/credentials/${credential.label}`,
        ),
      )}
  />
{/snippet}

<Modal
  title={`token pool: ${server.name}`}
  width="52rem"
  confirmLabel="done"
  confirmIcon="confirm"
  onConfirm={onclose}
  onCancel={onclose}
>
  <Note>
    Each call goes out with the least used token that has budget left. A token
    the server answers as rate limited rests until its window ends, and the call
    moves to the next.
  </Note>
  <DataTable
    {columns}
    rows={pool.data}
    rowKey={(credential) => credential.label}
    loading={pool.loading}
    error={pool.error}
    emptyTitle="No tokens in the pool."
    emptyDetail="Chat turns get none of this server's tools until one is added."
  />
  <form class="add" onsubmit={(e) => (e.preventDefault(), add())}>
    <input
      aria-label="label"
      placeholder="label, e.g. svc-1"
      bind:value={label}
    />
    <input
      aria-label="token"
      type="password"
      autocomplete="off"
      placeholder="paste a token"
      bind:value
    />
    <Button
      type="submit"
      size="sm"
      icon="save"
      busy={saving}
      disabled={!labelOk || !value.trim()}>add</Button
    >
  </form>
  {#if error}<Note tone="warn">{error}</Note>{/if}
</Modal>

<style>
  .add {
    display: grid;
    grid-template-columns: 12rem 1fr auto;
    gap: var(--pad-2);
    margin-top: var(--pad-2);
  }
  .dim {
    color: var(--muted);
  }
</style>
