<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { StoredItemPage, StoredItemRow } from "@tachy/contract";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { navigate } from "../shell/router.svelte";
  import type { Connection } from "../sources/rows";
  import {
    EMPTY,
    Badge,
    Button,
    DataTable,
    FilterBar,
    Select,
    Time,
    tip,
    type Column,
  } from "../tui";
  import { storedListPath } from "./stored";

  /** Long enough that a word typed at speed is one request. */
  const TYPING_PAUSE_MS = 250;

  let query = $state("");
  let connection = $state("");
  let connections = $state<Connection[]>([]);
  let items = $state<StoredItemRow[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state<string | null>(null);
  // A slow answer to an earlier filter must not replace a later one's.
  let asked = 0;

  async function load(offset = 0) {
    const mine = ++asked;
    loading = true;
    error = null;
    try {
      const page = await api.get<StoredItemPage>(
        storedListPath({ query, connection }, offset),
      );
      if (mine !== asked) return;
      items = offset ? [...items, ...page.items] : page.items;
      total = page.total;
    } catch (e) {
      if (mine === asked) error = errText(e);
    } finally {
      if (mine === asked) loading = false;
    }
  }

  let typed = false;
  $effect(() => {
    void query;
    // The first run is the mount, which loads on its own.
    if (!typed) return void (typed = true);
    const pause = setTimeout(() => untrack(() => void load()), TYPING_PAUSE_MS);
    return () => clearTimeout(pause);
  });

  onMount(() => {
    void load();
    void api
      .get<Connection[]>("/source-connections")
      .then((list) => (connections = list))
      .catch(() => {});
  });

  const columns: Column<StoredItemRow>[] = [
    { key: "updated_at", label: "changed", width: "10rem", cell: changedCell },
    { key: "external_id", label: "item", width: "11rem", cell: itemCell },
    { key: "title", label: "title", cell: titleCell },
    { key: "status", label: "status", width: "7rem" },
    { key: "assignee", label: "assignee", width: "9rem" },
    {
      key: "messages",
      label: "messages",
      width: "6rem",
      align: "end",
      value: (item) => item.messages,
    },
    {
      key: "events",
      label: "events",
      width: "5rem",
      align: "end",
      value: (item) => item.events,
    },
  ];
</script>

{#snippet changedCell(item: StoredItemRow)}
  <Time at={item.updated_at} />
{/snippet}

{#snippet itemCell(item: StoredItemRow)}
  <span class="id">#{item.external_id}</span>
  <span class="from">{item.connection}</span>
{/snippet}

{#snippet titleCell(item: StoredItemRow)}
  <span class="titled">
    <span class="title">{item.title ?? EMPTY}</span>
    {#if !item.fetched_at}
      <span
        use:tip={"only a listing has carried it: no messages are stored until it is fetched"}
        ><Badge>listed</Badge></span
      >
    {/if}
  </span>
{/snippet}

<div class="bar">
  <FilterBar
    bind:value={query}
    shown={items.length}
    {total}
    label="search stored items"
  />
  <Select
    bind:value={connection}
    options={connections.map((c) => ({ value: c.slug, label: c.slug }))}
    placeholder="any source"
    clearable
    active={!!connection}
    aria-label="filter by source"
    onchange={() => void load()}
  />
</div>

<DataTable
  {columns}
  rows={items}
  rowKey={(item) => item.id}
  {loading}
  {error}
  emptyTitle="no stored items"
  emptyDetail="a ticket or work item is stored when it is fetched in chat, by a flow or by a sync"
  onrowclick={(item) => navigate(`/console/integrations/tickets/${item.id}`)}
/>

{#if items.length < total}
  <Button
    variant="ghost"
    size="sm"
    disabled={loading}
    onclick={() => void load(items.length)}>more</Button
  >
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
  }
  .bar > :global(:first-child) {
    flex: 1;
  }
  .id {
    display: block;
  }
  .from {
    display: block;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .titled {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
