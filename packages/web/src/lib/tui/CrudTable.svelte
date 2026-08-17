<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import DataTable from "./DataTable.svelte";
  import Button from "./Button.svelte";
  import Select from "../AsciiSelect.svelte";
  import Note from "./Note.svelte";
  import { G } from "./glyphs";
  import {
    blankDraft,
    cellText,
    draftFrom,
    missingRequired,
    type Column,
    type Draft,
  } from "./table";

  let {
    columns,
    rows,
    rowKey,
    loading = false,
    error = null,
    emptyTitle = "nothing here yet",
    emptyDetail,
    canEdit = () => true,
    canDelete = () => true,
    canCreate = true,
    addLabel = "add",
    onsave,
    oncreate,
    ondelete,
    expand,
    expanded,
    ontoggle,
    extraActions,
    rowClass,
  }: {
    columns: Column<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    loading?: boolean;
    error?: string | null;
    emptyTitle?: string;
    emptyDetail?: string;
    canEdit?: (row: T) => boolean;
    canDelete?: (row: T) => boolean;
    canCreate?: boolean;
    addLabel?: string;
    onsave?: (row: T, draft: Draft) => Promise<void> | void;
    oncreate?: (draft: Draft) => Promise<void> | void;
    ondelete?: (row: T) => Promise<void> | void;
    expand?: Snippet<[T]>;
    expanded?: Set<string>;
    ontoggle?: (key: string) => void;
    extraActions?: Snippet<[T]>;
    rowClass?: (row: T) => string | undefined;
  } = $props();

  let editing = $state<string | null>(null);
  let draft = $state<Draft>({});
  let armed = $state<string | null>(null);
  let adding = $state(false);
  let newDraft = $state<Draft>({});
  let busy = $state<string | null>(null);
  let opError = $state<string | null>(null);

  const editables = $derived(
    columns.filter((c) => c.edit && c.edit !== "none"),
  );

  function startEdit(row: T) {
    editing = rowKey(row);
    draft = draftFrom(columns, row);
    armed = null;
    opError = null;
  }

  function cancelEdit() {
    editing = null;
    draft = {};
    opError = null;
  }

  function isEditable(c: Column<T>, row: T) {
    return (
      Boolean(c.edit) &&
      c.edit !== "none" &&
      (c.editable ? c.editable(row) : true)
    );
  }

  async function run(key: string, fn: () => Promise<void> | void) {
    busy = key;
    opError = null;
    try {
      await fn();
      return true;
    } catch (e) {
      opError = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      busy = null;
    }
  }

  async function commitEdit(row: T) {
    const missing = missingRequired(columns, draft);
    if (missing.length) {
      opError = `required: ${missing.join(", ")}`;
      return;
    }
    if (await run(rowKey(row), () => onsave?.(row, { ...draft }))) cancelEdit();
  }

  function startAdd() {
    adding = true;
    newDraft = blankDraft(columns);
    editing = null;
    opError = null;
  }

  async function commitAdd() {
    const missing = missingRequired(columns, newDraft);
    if (missing.length) {
      opError = `required: ${missing.join(", ")}`;
      return;
    }
    if (await run("::new", () => oncreate?.({ ...newDraft }))) {
      adding = false;
      newDraft = {};
    }
  }

  async function confirmDelete(row: T) {
    const key = rowKey(row);
    if (armed !== key) {
      armed = key;
      return;
    }
    armed = null;
    await run(key, () => ondelete?.(row));
  }
</script>

{#snippet control(c: Column<T>, d: Draft, autofocus = false)}
  {#if c.edit === "select"}
    <Select
      value={(d[c.key] ?? "") as string}
      options={c.options ?? []}
      aria-label={c.label}
      onchange={(v) => (d[c.key] = v)}
    />
  {:else if c.edit === "checkbox"}
    <input
      type="checkbox"
      aria-label={c.label}
      checked={Boolean(d[c.key])}
      onchange={(e) => (d[c.key] = e.currentTarget.checked)}
    />
  {:else if c.edit === "textarea"}
    <textarea
      rows="2"
      aria-label={c.label}
      placeholder={c.placeholder}
      value={String(d[c.key] ?? "")}
      oninput={(e) => (d[c.key] = e.currentTarget.value)}
    ></textarea>
  {:else}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      aria-label={c.label}
      placeholder={c.placeholder}
      autofocus={autofocus || undefined}
      value={String(d[c.key] ?? "")}
      oninput={(e) => (d[c.key] = e.currentTarget.value)}
    />
  {/if}
{/snippet}

{#snippet cellOverride(row: T, c: Column<T>)}
  {#if editing === rowKey(row) && isEditable(c, row)}
    {@render control(c, draft, c.key === editables[0]?.key)}
  {:else if c.cell}
    {@render c.cell(row)}
  {:else}
    <span class="v">{cellText(c, row)}</span>
  {/if}
{/snippet}

{#snippet actions(row: T)}
  {@const key = rowKey(row)}
  {#if editing === key}
    <Button
      variant="ghost"
      tone="accent"
      square
      icon="save"
      aria-label="save"
      busy={busy === key}
      onclick={() => commitEdit(row)}
    />
    <Button
      variant="ghost"
      square
      icon="cancel"
      aria-label="cancel"
      disabled={busy === key}
      onclick={cancelEdit}
    />
  {:else}
    {#if extraActions}{@render extraActions(row)}{/if}
    {#if onsave && canEdit(row)}
      <Button
        variant="ghost"
        tone="info"
        square
        icon="edit"
        aria-label="edit"
        onclick={() => startEdit(row)}
      />
    {/if}
    {#if ondelete && canDelete(row)}
      <Button
        variant="ghost"
        tone="danger"
        square
        icon={armed === key ? "check" : "cancel"}
        aria-label={armed === key ? "confirm delete" : "delete"}
        title={armed === key ? "click again to confirm" : "delete"}
        busy={busy === key}
        onclick={() => confirmDelete(row)}
      />
    {/if}
  {/if}
{/snippet}

{#snippet footer(span: number)}
  {#if adding}
    <tr class="addrow">
      <td colspan={span}>
        <div class="addform">
          {#each editables as c}
            <label class="f">
              <span class="fl"
                >{c.label}{#if c.required}<span class="req">*</span>{/if}</span
              >
              {@render control(c, newDraft, c.key === editables[0]?.key)}
            </label>
          {/each}
          <div class="addacts">
            <Button
              variant="ghost"
              tone="accent"
              size="sm"
              icon="save"
              busy={busy === "::new"}
              onclick={commitAdd}>{addLabel}</Button
            >
            <Button
              variant="ghost"
              size="sm"
              icon="cancel"
              disabled={busy === "::new"}
              onclick={() => (adding = false)}>cancel</Button
            >
          </div>
        </div>
      </td>
    </tr>
  {/if}
{/snippet}

{#if opError}
  <Note tone="danger">{opError}</Note>
{/if}

<DataTable
  {columns}
  {rows}
  {rowKey}
  {loading}
  {error}
  {emptyTitle}
  {emptyDetail}
  {expand}
  {expanded}
  {ontoggle}
  {rowClass}
  {cellOverride}
  {footer}
  actions={onsave || ondelete || extraActions ? actions : undefined}
/>

{#if oncreate && canCreate && !adding}
  <div class="addbar">
    <Button variant="ghost" tone="ok" size="sm" icon="plus" onclick={startAdd}
      >{addLabel}</Button
    >
  </div>
{/if}

<style>
  .v {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Inputs fill their fixed <col> track, so switching a row into edit mode
     never changes any column width. */
  .addform :global(input[type="text"]),
  .addform :global(textarea) {
    width: 100%;
  }

  .addbar {
    margin-top: var(--pad-2);
  }

  .addrow > td {
    padding: var(--pad-3) var(--pad-4);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .addform {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: var(--gap);
    align-items: end;
  }

  .f {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
  }
  .fl {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .req {
    color: var(--accent);
    margin-left: 0.15em;
  }

  .addacts {
    display: flex;
    gap: var(--pad-2);
    align-items: center;
  }
</style>
