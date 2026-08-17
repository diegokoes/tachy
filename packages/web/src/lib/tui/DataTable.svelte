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
    actionsWidth = "7rem",
    expand,
    expanded = new Set<string>(),
    ontoggle,
    rowClass,
    cellOverride,
    footer,
  }: {
    columns: Column<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    loading?: boolean;
    error?: string | null;
    emptyTitle?: string;
    emptyDetail?: string;
    actions?: Snippet<[T]>;
    actionsWidth?: string;
    expand?: Snippet<[T]>;
    expanded?: Set<string>;
    ontoggle?: (key: string) => void;
    rowClass?: (row: T) => string | undefined;
    /** Takes over every cell — used by CrudTable to swap in edit controls. */
    cellOverride?: Snippet<[T, Column<T>]>;
    footer?: Snippet<[number]>;
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
      {#if actions}<col style="width: {actionsWidth}" />{/if}
    </colgroup>

    <thead>
      <tr>
        {#if expand}<th aria-label="expand"></th>{/if}
        {#each columns as c}
          <th class={c.align === "end" ? "end" : ""}>{c.label}</th>
        {/each}
        {#if actions}<th class="end">actions</th>{/if}
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
              {#if cellOverride}{@render cellOverride(row, c)}
              {:else if c.cell}{@render c.cell(row)}
              {:else}<span class="v">{cellText(c, row)}</span>{/if}
            </td>
          {/each}
          {#if actions}
            <td class="acts">{@render actions(row)}</td>
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

      {#if footer}{@render footer(span)}{/if}
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

  .v {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  td.acts {
    text-align: right;
    white-space: nowrap;
  }
  td.acts :global(.btn) {
    vertical-align: middle;
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
