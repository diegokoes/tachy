<script lang="ts">
  import { Button } from "../tui";
  import { EXTRA_FILTERS, type FacetKey, type Facets } from "./filters";

  let {
    shown,
    facets,
    component,
    onadd,
    onremove,
  }: {
    shown: FacetKey[];
    facets: Facets;
    /** The component the row is scoped to, for the filters that need one. */
    component: string;
    onadd: (k: FacetKey) => void;
    onremove: (k: FacetKey) => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();

  /**
   * Every extra, always, in the same order — the ones already on the row are
   * marked rather than dropped. Picking three in a row is the normal way this
   * menu is used, and a list that reflows under the pointer after each pick
   * costs a misclick.
   *
   * A filter with nothing to offer under the current scope is listed but
   * disabled, so the menu still says the property exists.
   */
  const items = $derived(
    EXTRA_FILTERS.map((f) => ({
      ...f,
      added: shown.includes(f.key),
      count: (facets[f.key] ?? []).length,
      unscoped: !!f.needsComponent && !component,
      empty: f.kind !== "enum" && (facets[f.key] ?? []).length === 0,
    })),
  );

  function toggle(it: (typeof items)[number]) {
    if (it.added) onremove(it.key);
    else onadd(it.key);
  }
</script>

<svelte:window
  onmousedown={(e) => {
    if (root && !root.contains(e.target as Node)) open = false;
  }}
  onkeydown={(e) => {
    if (e.key === "Escape") open = false;
  }}
/>

<div class="menu" bind:this={root}>
  <Button
    variant="ghost"
    tone="ok"
    icon="plus"
    title="add a filter"
    onclick={() => (open = !open)}
  >
    <span class="lbl">add filter</span>
  </Button>
  {#if open}
    <ul>
      {#each items as it (it.key)}
        <li>
          <button
            type="button"
            class:added={it.added}
            aria-pressed={it.added}
            disabled={!it.added && (it.empty || it.unscoped)}
            title={it.added
              ? `remove the ${it.label} filter`
              : it.unscoped
                ? "pick a component first"
                : it.empty
                  ? "nothing recorded under the current filters"
                  : ""}
            onclick={() => toggle(it)}
          >
            <span class="mark" aria-hidden="true">{it.added ? "›" : " "}</span>
            <span class="t">{it.label}</span>
            <!-- Always present, empty for the enums: the label centres in the
                 same slot on every row, count or no count. -->
            <span class="n">{it.kind === "enum" || it.unscoped ? "" : it.count}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .menu {
    position: relative;
  }
  /* Cased in CSS, not in the copy — a screen reader still hears a word. */
  .lbl {
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
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
    border-radius: var(--radius-control);
    background: var(--panel-solid);
  }
  button {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: var(--gap);
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--text);
    background: none;
    border: none;
    border-radius: var(--radius-control);
    padding: var(--pad-1) var(--pad-2);
    cursor: pointer;
    white-space: nowrap;
  }
  .t {
    flex: 1;
    text-align: center;
  }
  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ok) 15%, transparent);
    color: var(--ok);
  }
  /* Already on the row: the same `›` the selects mark a chosen option with. */
  button.added {
    color: var(--ok);
  }
  .mark {
    flex: none;
    width: 0.6em;
    color: var(--ok);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .n {
    flex: none;
    min-width: 1.5ch;
    text-align: right;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
