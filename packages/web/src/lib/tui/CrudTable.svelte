<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import DataTable from "./DataTable.svelte";
  import Button from "./Button.svelte";
  import Note from "./Note.svelte";
  import RecordModal from "./RecordModal.svelte";
  import {
    blankDraft,
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
    editTitle,
    formExtra,
    onsave,
    oncreate,
    ondelete,
    expand,
    expanded,
    ontoggle,
    extraActions,
    rowClass,
    onform,
    hoist,
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
    /** Modal heading when editing; defaults to the row's key. */
    editTitle?: (row: T) => string;
    /** Extra controls inside the record form, below the columns. */
    formExtra?: Snippet<
      [{ mode: "create" | "edit"; row: T | null; draft: Draft }]
    >;
    onsave?: (row: T, draft: Draft) => Promise<void> | void;
    oncreate?: (draft: Draft) => Promise<void> | void;
    ondelete?: (row: T) => Promise<void> | void;
    expand?: Snippet<[T]>;
    expanded?: Set<string>;
    ontoggle?: (key: string) => void;
    extraActions?: Snippet<[T]>;
    rowClass?: (row: T) => string | undefined;
    /** Fires as the record form opens and closes, for state `formExtra` needs. */
    onform?: (f: { mode: "create" | "edit"; row: T | null } | null) => void;
    /**
     * Offers the add action to whoever is laying out the page, which then
     * draws it somewhere with more standing than a bar under the table. Given
     * one, the bar goes away rather than showing the same button twice.
     */
    hoist?: (a: { label: string; run: () => void } | null) => void;
  } = $props();

  $effect(() => {
    if (!hoist) return;
    const offer =
      oncreate && canCreate ? { label: addLabel, run: startAdd } : null;
    hoist(offer);
    return () => hoist(null);
  });

  /* Create and edit are the same form; only the commit differs. */
  let form = $state<{ mode: "create" | "edit"; row: T | null } | null>(null);
  let draft = $state<Draft>({});
  let armed = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let opError = $state<string | null>(null);

  const NEW = "::new";
  const formKey = $derived(
    form ? (form.row ? rowKey(form.row) : NEW) : null,
  );

  function startEdit(row: T) {
    draft = draftFrom(columns, row);
    form = { mode: "edit", row };
    armed = null;
    opError = null;
    onform?.(form);
  }

  function startAdd() {
    draft = blankDraft(columns);
    form = { mode: "create", row: null };
    armed = null;
    opError = null;
    onform?.(form);
  }

  function close() {
    form = null;
    draft = {};
    opError = null;
    onform?.(null);
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

  async function commit() {
    if (!form) return;
    const missing = missingRequired(columns, draft);
    if (missing.length) {
      opError = `required: ${missing.join(", ")}`;
      return;
    }
    const payload = { ...draft };
    const target = form.row;
    const ok = await run(target ? rowKey(target) : NEW, () =>
      target ? onsave?.(target, payload) : oncreate?.(payload),
    );
    if (ok) close();
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

{#snippet actions(row: T)}
  {@const key = rowKey(row)}
  {#if extraActions}{@render extraActions(row)}{/if}
  {#if onsave && canEdit(row)}
    <Button
      variant="ghost"
      tone="info"
      size="sm"
      icon="edit"
      title="edit"
      onclick={() => startEdit(row)}>edit</Button
    >
  {/if}
  {#if ondelete && canDelete(row)}
    <Button
      variant="ghost"
      tone="danger"
      size="sm"
      icon={armed === key ? "check" : "del"}
      title={armed === key ? "click again to confirm" : "delete"}
      busy={busy === key}
      onclick={() => confirmDelete(row)}
      >{armed === key ? "confirm" : "delete"}</Button
    >
  {/if}
{/snippet}

{#if opError && !form}
  <Note tone="danger">{opError}</Note>
{/if}

<DataTable
  columns={columns.filter((c) => !c.formOnly)}
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
  actions={onsave || ondelete || extraActions ? actions : undefined}
/>

{#if oncreate && canCreate && !hoist}
  <div class="addbar">
    <Button variant="ghost" tone="ok" size="sm" icon="plus" onclick={startAdd}
      >{addLabel}</Button
    >
  </div>
{/if}

{#if form}
  {@const f = form}
  <RecordModal
    title={f.row ? (editTitle?.(f.row) ?? `edit ${rowKey(f.row)}`) : addLabel}
    {columns}
    {draft}
    mode={f.mode}
    row={f.row ?? undefined}
    busy={busy === formKey}
    error={opError}
    onConfirm={commit}
    onCancel={close}
  >
    {#snippet extra()}
      {#if formExtra}{@render formExtra({
          mode: f.mode,
          row: f.row,
          draft,
        })}{/if}
    {/snippet}
  </RecordModal>
{/if}

<style>
  .addbar {
    margin-top: var(--pad-2);
  }
</style>
