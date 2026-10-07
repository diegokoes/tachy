<script lang="ts">
  import type { Snippet } from "svelte";
  import Counts from "./Counts.svelte";
  import type { Count } from "./overview";
  import { expandedKey } from "./expand.svelte";
  import { navigate, segment } from "../shell/router.svelte";
  import { tick } from "svelte";

  let {
    figures,
    loading = false,
    error = null,
    cols = 3,
    rows = 2,
    children,
  }: {
    /** The counters row, first because it is what a glance is for. */
    figures: Count[];
    loading?: boolean;
    error?: string | null;
    /** The tile grid under it, which always fills the rest of the window. */
    cols?: number;
    rows?: number;
    children: Snippet;
  } = $props();

  const expanded = $derived(expandedKey());
  let grid: HTMLElement | undefined = $state();

  // A link to a chart that is not there - a stale key, a tile the viewer may
  // not see - lands on the overview rather than on an empty window.
  $effect(() => {
    if (!expanded || loading) return;
    void tick().then(() => {
      if (grid && !grid.querySelector(".tile.open"))
        navigate(`/admin/${segment(1) ?? "integrations"}`, { replace: true });
    });
  });
</script>

<!--
@component
Every overview: a row of counters, then a grid of charts that shares out the
rest of the window, so the page never scrolls. Air on every side and no frame:
the window is the frame.
-->
<div class="overview" style="--cols: {cols}; --rows: {rows}">
  {#if error}<p class="error">{error}</p>{/if}
  {#if !expanded}<Counts items={figures} {loading} />{/if}
  <div class="tiles" class:whole={Boolean(expanded)} bind:this={grid}>
    {@render children()}
  </div>
</div>

<style>
  .overview {
    flex: 1 1 auto;
    /* The floor under which charts stop shrinking and the window scrolls
       instead, rather than drawing a dial the size of a letter. */
    min-height: 24rem;
    display: flex;
    flex-direction: column;
    gap: var(--view-pad-x);
    /* The bottom row's legends hang below their tiles, into this. */
    padding: var(--view-pad-y) var(--view-pad-x) calc(var(--pad-4) * 1.5);
    min-width: 0;
    container-type: inline-size;
    /* Counters and charts are for reading at a glance and clicking through,
       so a drag across them must not start a text selection. */
    user-select: none;
    cursor: default;
  }

  .tiles {
    flex: 1 1 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
    gap: calc(var(--pad-4) * 2) calc(var(--pad-4) * 2.25);
  }

  /* One tile, the whole window. The others stay mounted, hidden, so their
     data and the tile that is going back to its place are not rebuilt. */
  .tiles.whole {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .tiles.whole > :global(.tile:not(.open)),
  .tiles.whole > :global(.stack:not(:has(.tile.open))) {
    display: none;
  }
  .tiles.whole > :global(.tile.open),
  .tiles.whole > :global(.stack:has(.tile.open)) {
    grid-column: 1;
    grid-row: 1;
  }
  .tiles.whole :global(.stack > .tile:not(.open)) {
    display: none;
  }

  .error {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--danger);
    user-select: text;
    cursor: auto;
  }

  /* Narrow windows trade the one-screen rule for legible charts: two columns
     of fixed-height tiles, then one, and the window scrolls. */
  @container (max-width: 52rem) {
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: none;
      grid-auto-rows: 14rem;
    }
  }
  @container (max-width: 34rem) {
    .tiles {
      grid-template-columns: minmax(0, 1fr);
    }
    .tiles > :global(.tile) {
      grid-column: auto;
    }
  }
</style>
