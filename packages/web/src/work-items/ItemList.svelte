<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type {
    ComposerProject,
    WorkItemPage,
    WorkItemRow,
    WorkItemScope,
    WorkItemSort,
  } from "@tachy/contract";
  import { api } from "../api";
  import { createSequence, errText } from "../resource.svelte";
  import { navigate } from "../shell/router.svelte";
  import {
    Button,
    DataTable,
    FilterBar,
    Icon,
    Select,
    Time,
    type Column,
  } from "../tui";
  import { ensureTypes, typesOf } from "./az.svelte";
  import { typeColor, typeIcon } from "./ado-icons";
  import {
    DEFAULT_FILTER,
    boardItemPath,
    itemsPath,
    sortBy,
    type BoardFilter,
  } from "./board";

  let { project }: { project: ComposerProject } = $props();

  const PAGE_SIZE = 50;
  /** Long enough that a word typed at speed is one request. */
  const TYPING_PAUSE_MS = 250;

  const SCOPES: { value: WorkItemScope; label: string }[] = [
    { value: "all", label: "everyone's" },
    { value: "assigned", label: "assigned to me" },
    { value: "created", label: "created by me" },
  ];

  let filter = $state<BoardFilter>({ ...DEFAULT_FILTER });
  let items = $state<WorkItemRow[]>([]);
  let total = $state(0);
  let capped = $state(false);
  let loading = $state(true);
  let error = $state<string | null>(null);
  const nextLoad = createSequence();

  async function load(offset = 0) {
    const current = nextLoad();
    loading = true;
    error = null;
    try {
      const page = await api.get<WorkItemPage>(
        itemsPath(project.id, filter, offset, PAGE_SIZE),
      );
      if (!current()) return;
      items = offset ? [...items, ...page.items] : page.items;
      total = page.total;
      capped = page.capped;
    } catch (e) {
      if (current()) error = errText(e);
    } finally {
      if (current()) loading = false;
    }
  }

  onMount(() => {
    void ensureTypes(project.id);
    void load();
  });

  let typed = false;
  $effect(() => {
    void filter.text;
    // The first run is the mount, which loads on its own.
    if (!typed) return void (typed = true);
    const pause = setTimeout(() => untrack(() => void load()), TYPING_PAUSE_MS);
    return () => clearTimeout(pause);
  });

  function refilter(change: Partial<BoardFilter>) {
    Object.assign(filter, change);
    void load();
  }

  const columns: Column<WorkItemRow>[] = [
    { key: "id", label: "id", width: "6rem", cell: idCell, head: idHead },
    { key: "title", label: "title", cell: titleCell, head: titleHead },
    {
      key: "state",
      label: "state",
      width: "8rem",
      value: (row) => row.state,
      head: stateHead,
    },
    {
      key: "assigned",
      label: "assigned",
      width: "10rem",
      value: (row) => row.assigned_to,
      head: assignedHead,
    },
    {
      key: "changed",
      label: "changed",
      width: "10.5rem",
      cell: changedCell,
      head: changedHead,
    },
    {
      key: "created",
      label: "created",
      width: "10.5rem",
      cell: createdCell,
      head: createdHead,
    },
  ];
</script>

{#snippet sortable(sort: WorkItemSort, label: string)}
  <button
    class="sort"
    class:on={filter.sort === sort}
    aria-label="sort by {label}"
    onclick={() => refilter(sortBy(filter, sort))}
  >
    {label}
    {#if filter.sort === sort}
      <Icon
        name={filter.direction === "asc" ? "sortAscending" : "sortDescending"}
        size="0.9em"
      />
    {/if}
  </button>
{/snippet}

{#snippet idHead()}{@render sortable("id", "id")}{/snippet}
{#snippet titleHead()}{@render sortable("title", "title")}{/snippet}
{#snippet stateHead()}{@render sortable("state", "state")}{/snippet}
{#snippet assignedHead()}{@render sortable("assigned", "assigned")}{/snippet}
{#snippet changedHead()}{@render sortable("changed", "changed")}{/snippet}
{#snippet createdHead()}{@render sortable("created", "created")}{/snippet}

{#snippet idCell(row: WorkItemRow)}
  <span class="id">#{row.id}</span>
{/snippet}

{#snippet titleCell(row: WorkItemRow)}
  <span class="titled">
    <span class="glyph" style:color={typeColor(row.color) ?? undefined}>
      <Icon name={typeIcon(row.icon)} size="1em" label={row.type} />
    </span>
    <span class="title">{row.title}</span>
  </span>
{/snippet}

{#snippet changedCell(row: WorkItemRow)}
  <Time at={row.changed_at} />
{/snippet}

{#snippet createdCell(row: WorkItemRow)}
  <Time at={row.created_at} />
{/snippet}

<div class="bar">
  <FilterBar
    bind:value={filter.text}
    shown={items.length}
    {total}
    label="search titles or an id"
  />
  <Select
    value={filter.scope}
    options={SCOPES}
    aria-label="whose items"
    onchange={(scope) => refilter({ scope: scope as WorkItemScope })}
  />
  <Select
    value={filter.type}
    options={typesOf(project.id).map((t) => ({ value: t.name, label: t.name }))}
    placeholder="any type"
    clearable
    active={!!filter.type}
    aria-label="filter by type"
    onchange={(type) => refilter({ type: String(type ?? "") })}
  />
</div>

<DataTable
  {columns}
  rows={items}
  rowKey={(row) => row.id}
  {loading}
  {error}
  emptyTitle="No work item matches."
  emptyDetail="Widen whose items, or clear the type and the search."
  onrowclick={(row) => navigate(boardItemPath(project.id, row.id))}
/>

{#if items.length < total}
  <div class="more">
    <Button size="sm" busy={loading} onclick={() => load(items.length)}
      >show more</Button
    >
  </div>
{:else if capped}
  <p class="note">
    The first {total} matches are listed; narrow the search for the rest.
  </p>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2);
    margin-bottom: var(--pad-3);
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .sort.on {
    color: var(--accent);
  }
  .id {
    color: var(--accent);
  }
  .titled {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
  }
  .glyph {
    flex: none;
    display: inline-flex;
    color: var(--muted);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .more {
    display: flex;
    justify-content: center;
    margin-top: var(--pad-3);
  }
  .note {
    font-size: var(--fs-sm);
    color: var(--muted);
  }
</style>
