<script lang="ts">
  import type { Snippet } from "svelte";
  import { Checkbox, Meter, tip } from "../../tui";

  let {
    checked,
    disabled = false,
    label,
    about,
    depth = 0,
    share,
    count,
    onchange,
    lead,
    children,
    end,
  }: {
    /** On means indexed, for every list on the repo page. */
    checked: boolean;
    disabled?: boolean;
    /** The toggle's accessible name. */
    label: string;
    about?: string;
    depth?: number;
    /** This row's part of its whole, drawn as a meter. */
    share?: number;
    count?: string;
    onchange: (on: boolean) => void;
    /** Ahead of the toggle: a tree's chevron. */
    lead?: Snippet;
    children: Snippet;
    /** Between the name and the meter: badges, a per-row action. */
    end?: Snippet;
  } = $props();
</script>

<!-- One shape for folders, file types and release lines: the toggle, the
     name, then the share and the count against the right edge, so every list
     on the page reads the same way and ticked always means indexed. -->
<div class="trow" class:off={!checked} style:--depth={depth}>
  {#if lead}{@render lead()}{/if}
  <Checkbox {checked} {disabled} ariaLabel={label} {onchange} />
  <span class="name" use:tip={about}>{@render children()}</span>
  {#if end}<span class="end">{@render end()}</span>{/if}
  {#if share !== undefined}
    <Meter value={share} width={8} tone={checked ? "accent" : "muted"} />
  {/if}
  {#if count !== undefined}<span class="count">{count}</span>{/if}
</div>

<style>
  .trow {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-height: var(--row-h);
    padding-left: calc(var(--depth) * 1.1rem);
    font-size: var(--fs-sm);
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .off .name {
    color: var(--muted);
  }
  .end {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
    flex: none;
  }
  .count {
    flex: none;
    min-width: 4.5rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
