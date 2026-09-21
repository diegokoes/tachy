<script lang="ts">
  import type { Snippet } from "svelte";
  import Counts, { type Count } from "./Counts.svelte";

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
</script>

<!-- Every overview is this and nothing else: a row of counters, then a grid of
     charts that shares out the rest of the window, so the page never scrolls.
     Air on every side rather than a frame — the window is the frame. -->
<div class="overview" style="--cols: {cols}; --rows: {rows}">
  {#if error}<p class="error">{error}</p>{/if}
  <Counts items={figures} {loading} />
  <div class="tiles">{@render children()}</div>
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
    padding: var(--view-pad-y) var(--view-pad-x) var(--pad-4);
    min-width: 0;
    container-type: inline-size;
  }

  .tiles {
    flex: 1 1 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
    gap: calc(var(--pad-4) * 2) calc(var(--pad-4) * 2.25);
  }

  .error {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--danger);
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
