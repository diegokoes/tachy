<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { cellText, type Column } from "./table";
  import EmptyState from "./EmptyState.svelte";
  import Note from "./Note.svelte";
  import { G } from "./glyphs";

  let {
    columns,
    rows,
    rowKey,
    loading = false,
    error = null,
    emptyTitle = "nothing here yet",
    emptyDetail,
    expand,
    expanded = new Set<string>(),
    ontoggle,
    rowClass,
    onrowclick,
    canOpen = () => true,
  }: {
    columns: Column<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    loading?: boolean;
    error?: string | null;
    emptyTitle?: string;
    emptyDetail?: string;
    expand?: Snippet<[T]>;
    expanded?: Set<string>;
    ontoggle?: (key: string) => void;
    rowClass?: (row: T) => string | undefined;
    /** Opening a row is the row's own job now, so the whole of it is the target. */
    onrowclick?: (row: T) => void;
    /** Rows this caller will not open. They take no pointer and no tab stop. */
    canOpen?: (row: T) => boolean;
  } = $props();

  /* A row is a target, not a link: a click that landed on a control inside it
     belongs to that control, and one that ended a drag was selecting text to
     copy, not asking to open anything. */
  function opens(e: MouseEvent): boolean {
    const el = e.target as HTMLElement | null;
    if (el?.closest("button,a,input,select,textarea,label")) return false;
    const sel = window.getSelection();
    return !sel || sel.isCollapsed;
  }

  const span = $derived(columns.length + (expand ? 1 : 0));
</script>

{#if error}
  <Note tone="danger">{error}</Note>
{/if}

<div class="wrap">
  <table>
    <colgroup>
      {#if expand}<col style="width: 2.2rem" />{/if}
      {#each columns as c}<col style={c.width ? `width: ${c.width}` : ""} />{/each}
    </colgroup>

    <thead>
      <tr>
        {#if expand}<th aria-label="expand"></th>{/if}
        {#each columns as c}
          <th class={c.align === "end" ? "end" : ""}>{c.label}</th>
        {/each}
      </tr>
    </thead>

    <tbody>
      {#each rows as row (rowKey(row))}
        {@const key = rowKey(row)}
        {@const open = expanded.has(key)}
        {@const openRow = onrowclick && canOpen(row) ? onrowclick : undefined}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
        <tr
          class={rowClass?.(row)}
          class:open={Boolean(openRow)}
          tabindex={openRow ? 0 : undefined}
          onclick={openRow && ((e) => opens(e) && openRow(row))}
          onkeydown={openRow &&
            ((e) => {
              if (e.key !== "Enter" || e.target !== e.currentTarget) return;
              e.preventDefault();
              openRow(row);
            })}
        >
          {#if expand}
            <td class="exp">
              <button
                type="button"
                aria-expanded={open}
                aria-label={open ? "collapse" : "expand"}
                onclick={() => ontoggle?.(key)}>{open ? G.expanded : G.right}</button
              >
            </td>
          {/if}
          {#each columns as c}
            <td class={c.align === "end" ? "end" : ""}>
              {#if c.cell}{@render c.cell(row)}
              {:else}<span class="v">{cellText(c, row)}</span>{/if}
            </td>
          {/each}
        </tr>
        {#if expand && open}
          <tr class="detail">
            <td colspan={span}>{@render expand(row)}</td>
          </tr>
        {/if}
      {/each}

      {#if !rows.length}
        <tr class="none">
          <td colspan={span}>
            {#if loading}
              <p class="loading">loading…</p>
            {:else}
              <EmptyState title={emptyTitle} detail={emptyDetail} />
            {/if}
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }

  /* Fixed layout is the whole point: a cell that switches to an <input> keeps
     the column width it already had, so nothing reflows mid-edit. */
  table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }

  th,
  td {
    text-align: left;
    padding: var(--pad-1) var(--pad-3);
    vertical-align: middle;
    height: var(--row-h);
  }
  th.end,
  td.end {
    text-align: right;
  }

  th {
    font-weight: normal;
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    /* Headers truncate like cells — a fixed layout squeezes the auto column,
       and a nowrap header would otherwise overrun its neighbour. */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  tbody tr {
    border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }
  tbody tr:hover:not(.none):not(.detail) {
    background: var(--accent-dim);
  }

  /* The row is the button. A rank of marks that only appeared under the
     pointer was three things to aim at where there is one thing to open, and
     it hid on every row a keyboard user was not already inside. */
  tbody tr.open {
    cursor: pointer;
  }
  tbody tr.open:focus-visible {
    outline: none;
    background: var(--accent-dim);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  /* Plain cell values only — ids, slugs, counts, dates, all of which are read
     by comparing one row against the one above it. A `cell` snippet renders
     its own chips and buttons and stays on the UI face. */
  .v {
    display: block;
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Rows no longer carry a rank of action marks. Opening one is the row's own
     click, and everything you can do to a record — delete, test, reindex — is
     in the titlebar of the record you opened. */
  .exp button {
    font: inherit;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }
  .exp button:hover {
    color: var(--accent);
  }

  tr.detail > td {
    padding: var(--pad-3) var(--pad-4);
    background: color-mix(in srgb, var(--muted) 7%, transparent);
  }

  tr.none > td {
    height: auto;
  }
  .loading {
    margin: 0;
    padding: var(--pad-4);
    text-align: center;
    color: var(--muted);
  }
</style>
