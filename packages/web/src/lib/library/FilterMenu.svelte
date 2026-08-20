<script lang="ts">
  import { Button } from "../tui";
  import { EXTRA_FILTERS, type FacetKey, type Facets } from "./filters.svelte";

  let {
    shown,
    facets,
    onadd,
  }: {
    shown: FacetKey[];
    facets: Facets;
    onadd: (k: FacetKey) => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();

  /** A filter with nothing to offer under the current scope is listed but
   *  disabled, so the menu still says the property exists. */
  const items = $derived(
    EXTRA_FILTERS.filter((f) => !shown.includes(f.key)).map((f) => ({
      ...f,
      count: (facets[f.key] ?? []).length,
      empty: f.kind !== "enum" && (facets[f.key] ?? []).length === 0,
    })),
  );
</script>

<svelte:window
  onmousedown={(e) => {
    if (root && !root.contains(e.target as Node)) open = false;
  }}
  onkeydown={(e) => {
    if (e.key === "Escape") open = false;
  }}
/>

{#if items.length}
  <div class="menu" bind:this={root}>
    <Button
      variant="ghost"
      size="sm"
      square
      tone="ok"
      icon="plus"
      title="add a filter"
      aria-label="add a filter"
      onclick={() => (open = !open)}
    />
    {#if open}
      <ul>
        {#each items as it (it.key)}
          <li>
            <button
              type="button"
              disabled={it.empty}
              title={it.empty ? "nothing recorded under the current filters" : ""}
              onclick={() => {
                onadd(it.key);
                open = false;
              }}
            >
              <span class="t">{it.label}</span>
              {#if it.kind !== "enum"}<span class="n">{it.count}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .menu {
    position: relative;
  }
  ul {
    position: absolute;
    z-index: var(--z-dropdown);
    top: calc(100% + var(--pad-1));
    right: 0;
    min-width: 13rem;
    list-style: none;
    margin: 0;
    padding: var(--pad-1);
    border: 1px solid var(--ok);
    border-radius: var(--radius);
    background: var(--panel-solid);
  }
  button {
    display: flex;
    width: 100%;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gap);
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--text);
    background: none;
    border: none;
    border-radius: var(--radius);
    padding: var(--pad-1) var(--pad-2);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }
  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ok) 15%, transparent);
    color: var(--ok);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .n {
    flex: none;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
