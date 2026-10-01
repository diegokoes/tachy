<script lang="ts">
  import type { Snippet } from "svelte";
  import { Meter, tip } from "../../tui";

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
    icon,
    children,
    end,
  }: {
    /** On means indexed, for every list on the repo page. */
    checked: boolean;
    disabled?: boolean;
    /** The switch's accessible name. */
    label: string;
    about?: string;
    depth?: number;
    /** This row's part of its whole, drawn as a meter. */
    share?: number;
    count?: string;
    onchange: (on: boolean) => void;
    /** Ahead of the switch: a tree's chevron. */
    lead?: Snippet;
    /** Lit green while on; a coloured file icon goes grey while off. */
    icon: Snippet;
    children: Snippet;
    /** Between the name and the meter: badges, a per-row action. */
    end?: Snippet;
  } = $props();
</script>

<!-- One shape for folders, file types and release lines. The icon and name
     are the switch: lit means indexed, grey means left out. -->
<div class="trow" style:--depth={depth}>
  {#if lead}{@render lead()}{/if}
  <button
    type="button"
    class="sw"
    class:on={checked}
    role="switch"
    aria-checked={checked}
    aria-label={label}
    {disabled}
    use:tip={about}
    onclick={() => onchange(!checked)}
  >
    <span class="ico">{@render icon()}</span>
    <span class="name">{@render children()}</span>
  </button>
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
    min-height: 1.45rem;
    padding-left: calc(var(--depth) * 1.1rem);
    font-size: var(--fs-sm);
  }
  .sw {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .sw.on {
    color: var(--text);
  }
  .sw:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .ico {
    display: inline-flex;
    flex: none;
    color: var(--muted);
    transition: color 0.15s ease;
  }
  .sw.on .ico {
    color: var(--ok);
  }
  .ico :global(img) {
    filter: grayscale(1);
    opacity: 0.45;
    transition:
      filter 0.15s ease,
      opacity 0.15s ease;
  }
  .sw.on .ico :global(img) {
    filter: none;
    opacity: 1;
  }
  .sw:not(:disabled):hover .name,
  .sw:focus-visible .name {
    color: var(--accent);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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
