<script lang="ts" generics="T">
  import { untrack, type Snippet } from "svelte";
  import { errText } from "../resource.svelte";
  import { pushScope } from "../keys.svelte";
  import { vimState } from "../vim.svelte";
  import { setTopActions } from "../subnav.svelte";
  import {
    Button,
    EmptyState,
    G,
    Note,
    RecordForm,
    blankDraft,
    cellText,
    draftFrom,
    missingRequired,
    type Column,
    type Draft,
  } from "../tui";
  import StatusActions from "../library/StatusActions.svelte";
  import type { StatusAction } from "../library/status";

  /**
   * One admin record on a page of its own, the way the library opens an entry:
   * back and edit in the carved row while reading, delete, cancel and save
   * there while editing, and what can be done to the record (run, test) in a
   * rail down the left. What used to hide behind a row's expand arrow is the
   * page's body, so the record and everything hanging off it read as one
   * thing.
   */
  let {
    noun,
    title,
    columns,
    row,
    creating = false,
    loading = false,
    loadError = null,
    canEdit = true,
    canDelete = true,
    actions = [],
    body,
    formExtra,
    onform,
    onsave,
    oncreate,
    ondelete,
    onclose,
  }: {
    /** What one record is, singular: "customer", "job". */
    noun: string;
    title: string;
    columns: Column<T>[];
    /** The record, or null while it loads, when it is gone, or when creating. */
    row: T | null;
    /** A blank record, opened straight into its form. */
    creating?: boolean;
    loading?: boolean;
    loadError?: string | null;
    canEdit?: boolean;
    canDelete?: boolean;
    actions?: StatusAction[];
    /** Everything hanging off the record, under its fields while reading. */
    body?: Snippet<[T]>;
    formExtra?: Snippet<[{ mode: "create" | "edit"; row: T | null; draft: Draft }]>;
    /** Fires as the form opens and closes, for state `formExtra` needs. */
    onform?: (f: { mode: "create" | "edit"; row: T | null } | null) => void;
    onsave?: (row: T, draft: Draft) => Promise<unknown> | void;
    /** Should navigate to the record it made; the page cannot know its key. */
    oncreate?: (draft: Draft) => Promise<unknown> | void;
    ondelete?: (row: T) => Promise<unknown> | void;
    onclose: () => void;
  } = $props();

  let editing = $state(false);
  let draft = $state<Draft>({});
  let busy = $state<"save" | "delete" | null>(null);
  let armed = $state(false);
  let opError = $state<string | null>(null);

  const mode = $derived(row ? ("edit" as const) : ("create" as const));

  /* Read-only fields show everything but secrets: a form-only field such as
     notes is still part of the record, and a write-only token has nothing to
     show. */
  const shown = $derived(columns.filter((c) => c.edit !== "secret"));

  /* Seeded once the data a blank draft reads its defaults from has arrived —
     opening /new cold, a select's first option is not known before that. */
  let seeded = false;
  $effect(() => {
    if (!creating || loading || seeded) return;
    seeded = true;
    untrack(() => {
      draft = blankDraft(columns);
      editing = true;
      onform?.({ mode: "create", row: null });
    });
  });

  function startEdit() {
    if (!row) return;
    draft = draftFrom(columns, row);
    editing = true;
    armed = false;
    opError = null;
    onform?.({ mode: "edit", row });
  }

  function stopEdit() {
    if (creating) return onclose();
    editing = false;
    armed = false;
    opError = null;
    onform?.(null);
  }

  async function commit() {
    const missing = missingRequired(columns, draft);
    if (missing.length) {
      opError = `required: ${missing.join(", ")}`;
      return;
    }
    const payload = { ...draft };
    busy = "save";
    opError = null;
    try {
      if (row) {
        await onsave?.(row, payload);
        stopEdit();
      } else {
        await oncreate?.(payload);
      }
    } catch (e) {
      opError = errText(e);
    } finally {
      busy = null;
    }
  }

  async function confirmDelete() {
    if (!row) return;
    if (!armed) {
      armed = true;
      return;
    }
    armed = false;
    busy = "delete";
    opError = null;
    try {
      await ondelete?.(row);
      onclose();
    } catch (e) {
      opError = errText(e);
    } finally {
      busy = null;
    }
  }

  /** Reading, backspace goes back. Not while editing, where it would sit one
      stray keystroke away from discarding a form. */
  $effect(() => {
    if (editing) return;
    return pushScope([
      { key: "backspace", label: "", hidden: true, run: onclose },
      ...(vimState.enabled
        ? [{ key: "esc", label: "", hidden: true, run: onclose }]
        : []),
    ]);
  });

  $effect(() => setTopActions(editing ? editActions : readActions));
</script>

<!-- Both rendered by App into the carved row beside the subnav, not here.
     Small, as admin's own buttons there are: delete, cancel and save at full
     size overrun the corner. -->
{#snippet readActions()}
  <Button size="sm" icon="back" title="back (backspace)" onclick={onclose}
    >back</Button
  >
  {#if row && canEdit && onsave}
    <Button size="sm" tone="info" icon="edit" title="edit" onclick={startEdit}
      >edit</Button
    >
  {/if}
{/snippet}

{#snippet editActions()}
  <!-- A mark, not a captioned button: three captions overrun the corner, and
       it is the same destructive mark the record dialog draws. -->
  {#if row && ondelete && canDelete}
    <Button
      variant="ghost"
      tone="danger"
      square
      icon={armed ? "check" : "del"}
      title={armed ? "click again to delete" : `delete this ${noun}`}
      aria-label={armed ? "confirm delete" : "delete"}
      busy={busy === "delete"}
      onclick={confirmDelete}
    />
  {/if}
  <Button size="sm" icon="cancel" disabled={busy !== null} onclick={stopEdit}
    >cancel</Button
  >
  <Button
    size="sm"
    variant="primary"
    icon="save"
    busy={busy === "save"}
    onclick={commit}>save</Button
  >
{/snippet}

{#snippet formBottom()}
  {@render formExtra?.({ mode, row, draft })}
{/snippet}

<div class="record" class:railed={!editing && actions.length > 0}>
  {#if !editing && actions.length}
    <div class="side"><StatusActions {actions} docked /></div>
  {/if}

  <div class="main">
    <h2 class="head">
      <span class="mark" aria-hidden="true">{G.marker}</span>
      <span class="noun">{creating ? `new ${noun}` : noun}</span>
      {#if title}<span class="name">{title}</span>{/if}
      <span class="rule" aria-hidden="true"></span>
    </h2>

    {#if opError}<Note tone="danger">{opError}</Note>{/if}
    {#if armed}
      <Note tone="warn">Click the delete mark again to delete this {noun}.</Note>
    {/if}

    {#if loadError}
      <Note tone="danger">{loadError}</Note>
    {:else if loading && !row}
      <p class="loading">loading…</p>
    {:else if editing}
      <RecordForm
        {columns}
        {draft}
        {mode}
        row={row ?? undefined}
        onleave={stopEdit}
        extra={formExtra ? formBottom : undefined}
      />
    {:else if row}
      <dl class="fields">
        {#each shown as c (c.key)}
          {@const prose = c.edit === "textarea"}
          <div class="f" class:prose>
            <dt>{c.label}</dt>
            <dd>
              {#if c.cell}{@render c.cell(row)}
              {:else}<span class="v">{cellText(c, row)}</span>{/if}
            </dd>
          </div>
        {/each}
      </dl>
      {#if body}<div class="body">{@render body(row)}</div>{/if}
    {:else if !creating}
      <EmptyState
        title="No such {noun}."
        detail="It may have been renamed or deleted."
      />
    {/if}
  </div>
</div>

<style>
  .record.railed {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: calc(var(--pad-4) * 2);
    align-items: start;
  }
  .main {
    min-width: 0;
  }

  /* The section heading's shape, so a record reads as opened from one. */
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    margin: 0 0 var(--pad-3);
    padding: var(--pad-2) 0;
    font-size: var(--fs-sm);
    font-weight: 500;
    letter-spacing: var(--label-spacing);
  }
  .mark {
    flex: none;
    font-family: var(--font-mono);
    color: var(--accent);
  }
  .noun {
    flex: none;
    color: var(--muted);
  }
  .name {
    min-width: 0;
    font-size: var(--fs-lg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rule {
    flex: 1;
    align-self: center;
    height: 1px;
    background: var(--border);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: var(--pad-3) var(--pad-4);
    margin: 0 0 var(--pad-4);
  }
  .f {
    min-width: 0;
  }
  /* Notes are sentences, not identifiers: the whole row, wrapped. */
  .f.prose {
    grid-column: 1 / -1;
  }
  .f.prose .v {
    font-family: inherit;
    white-space: pre-wrap;
  }
  dt {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  dd {
    margin: var(--pad-1) 0 0;
    font-size: var(--fs-sm);
  }
  .v {
    display: block;
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .body {
    padding-top: var(--pad-3);
    border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }

  .loading {
    color: var(--muted);
  }

  /* No margin left to put the rail in: it rejoins the flow above the record,
     as StatusActions itself does at this width. */
  @media (max-width: 68rem) {
    .record.railed {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
