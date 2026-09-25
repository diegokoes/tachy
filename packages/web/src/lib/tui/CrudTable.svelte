<script lang="ts" generics="T">
  import { onDestroy, untrack, type Snippet } from "svelte";
  import { forget, keep, recall } from "../kept";
  import { router, sectionNow } from "../router.svelte";
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
    noun,
    editTitle,
    width,
    formExtra,
    onsave,
    oncreate,
    ondelete,
    onopen,
    onadd,
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
    /**
     * What one row is, singular — "project", "repo". It prefixes the record
     * dialog's name, because a dialog titled with a bare slug says what you
     * are editing but never what kind of thing it is.
     */
    noun?: string;
    /** Names the row in the dialog title; defaults to the row's key. */
    editTitle?: (row: T) => string;
    /** Widens the record dialog, for a record that carries more than fields. */
    width?: string;
    /** Extra controls inside the record form, below the columns. */
    formExtra?: Snippet<
      [{ mode: "create" | "edit"; row: T | null; draft: Draft }]
    >;
    onsave?: (row: T, draft: Draft) => Promise<void> | void;
    oncreate?: (draft: Draft) => Promise<void> | void;
    ondelete?: (row: T) => Promise<void> | void;
    /**
     * Opens the row somewhere other than the record dialog — a page of its
     * own. Given one, a row click calls it and the dialog never opens.
     */
    onopen?: (row: T) => void;
    /** Starts a new record somewhere other than the dialog, as `onopen` does. */
    onadd?: () => void;
    extraActions?: Snippet<[T]>;
    rowClass?: (row: T) => string | undefined;
    /** Fires as the record form opens and closes, for state `formExtra` needs. */
    onform?: (f: { mode: "create" | "edit"; row: T | null } | null) => void;
    /**
     * Offers the add action to whoever lays out the page, which draws it on
     * the section heading. Given one, the bar under the table goes away.
     */
    hoist?: (a: { label: string; run: () => void } | null) => () => void;
  } = $props();

  $effect(() => {
    if (!hoist) return;
    const offer =
      (onadd || oncreate) && canCreate
        ? { label: addLabel, run: onadd ?? startAdd }
        : null;
    // The store's own disposer, so releasing the row cannot clobber a claim
    // made by the panel replacing this one.
    return hoist(offer);
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

  /* An open record, draft and all, survives leaving the section, so coming
     back finds it as it was. Closing it, or moving elsewhere inside the
     section, forgets it as before. */
  const memo = untrack(() => `crud:${router.path}:${noun ?? addLabel}`);
  const home = sectionNow();
  let resume = $state(recall<{ key: string; draft: Draft } | null>(memo, null));

  $effect(() => {
    if (!resume || loading) return;
    const { key, draft: left } = resume;
    const row = key === NEW ? null : rows.find((r) => rowKey(r) === key);
    if (row === undefined) {
      if (rows.length) resume = null;
      return;
    }
    if (row) startEdit(row);
    else startAdd();
    draft = left;
  });

  $effect(() => {
    if (resume) return;
    if (formKey) keep(memo, { key: formKey, draft: $state.snapshot(draft) });
    else forget(memo);
  });

  onDestroy(() => {
    if (sectionNow() === home) forget(memo);
  });

  function startEdit(row: T) {
    resume = null;
    draft = draftFrom(columns, row);
    form = { mode: "edit", row };
    armed = null;
    opError = null;
    onform?.(form);
  }

  function startAdd() {
    resume = null;
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
    if (await run(key, () => ondelete?.(row))) close();
  }
</script>

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
  {rowClass}
  onrowclick={onopen ?? (onsave ? startEdit : undefined)}
  canOpen={canEdit}
/>

{#if (onadd || oncreate) && canCreate && !hoist}
  <div class="addbar">
    <Button
      variant="ghost"
      tone="ok"
      size="sm"
      icon="plus"
      onclick={onadd ?? startAdd}
      >{addLabel}</Button
    >
  </div>
{/if}

{#if form}
  {@const f = form}
  {@const named = f.row ? (editTitle?.(f.row) ?? rowKey(f.row)) : null}
  {@const key = f.row ? rowKey(f.row) : NEW}
  <RecordModal
    title={named
      ? noun
        ? `${noun}: ${named}`
        : named
      : addLabel}
    {columns}
    {draft}
    {width}
    mode={f.mode}
    row={f.row ?? undefined}
    busy={busy === formKey}
    error={opError}
    onConfirm={commit}
    destructive={f.row && ondelete && canDelete(f.row)
      ? {
          label: armed === key ? "click again to confirm" : "delete",
          icon: armed === key ? "check" : "del",
          busy: busy === key,
          onclick: () => f.row && confirmDelete(f.row),
        }
      : undefined}
    onCancel={close}
  >
    {#snippet barExtra()}
      {#if extraActions && f.row}{@render extraActions(f.row)}{/if}
    {/snippet}
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
