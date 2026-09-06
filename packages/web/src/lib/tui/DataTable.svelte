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
    actions,
    expand,
    expanded = new Set<string>(),
    ontoggle,
    rowClass,
  }: {
    columns: Column<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    loading?: boolean;
    error?: string | null;
    emptyTitle?: string;
    emptyDetail?: string;
    actions?: Snippet<[T]>;
    expand?: Snippet<[T]>;
    expanded?: Set<string>;
    ontoggle?: (key: string) => void;
    rowClass?: (row: T) => string | undefined;
  } = $props();

  const span = $derived(columns.length + (expand ? 1 : 0) + (actions ? 1 : 0));
</script>

{#if error}
  <Note tone="danger">{error}</Note>
{/if}

<div class="wrap">
  <table>
    <colgroup>
      {#if expand}<col style="width: 2.2rem" />{/if}
      {#each columns as c}<col style={c.width ? `width: ${c.width}` : ""} />{/each}
      {#if actions}<col style="width: 0" />{/if}
    </colgroup>

    <thead>
      <tr>
        {#if expand}<th aria-label="expand"></th>{/if}
        {#each columns as c}
          <th class={c.align === "end" ? "end" : ""}>{c.label}</th>
        {/each}
        {#if actions}<th aria-label="actions"></th>{/if}
      </tr>
    </thead>

    <tbody>
      {#each rows as row (rowKey(row))}
        {@const key = rowKey(row)}
        {@const open = expanded.has(key)}
        <tr class={rowClass?.(row)}>
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
          {#if actions}
            <td class="acts">
              <div class="overlay">{@render actions(row)}</div>
            </td>
          {/if}
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

  /* Row actions do not get a column. A track wide enough for three buttons is
     blank on every row nobody is pointing at, and it was taking 7rem off the
     content on every table in the app. The cell keeps no width; its overlay
     spans the row and fades in over a scrim, so the marks read against the
     values rather than beside them.

     opacity, not visibility: an invisible button is still focusable, so
     tabbing into a row is what raises its actions — which is the only way a
     keyboard reaches them now.

     The scrim takes no pointer events, only the marks on it do. A full-row hit
     area would eat the expander chevron under its transparent left edge, and
     take the row's text out of selection the moment you pointed at it. */
  tbody tr {
    position: relative;
  }
  td.acts {
    width: 0;
    padding: 0;
  }
  td.acts .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pad-2);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, var(--panel-bg) 92%, transparent) 15%,
      color-mix(in srgb, var(--panel-bg) 92%, transparent) 85%,
      transparent 100%
    );
  }
  tbody tr:hover td.acts .overlay,
  tbody tr:focus-within td.acts .overlay {
    opacity: 1;
  }
  td.acts .overlay :global(.btn) {
    pointer-events: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    td.acts .overlay {
      transition: none;
    }
  }

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
