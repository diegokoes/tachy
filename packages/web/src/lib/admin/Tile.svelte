<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    meta,
    span = 1,
    empty = false,
    children,
  }: {
    title: string;
    /** Right of the title: the window it covers, or its total. */
    meta?: string;
    /** Grid columns it takes. */
    span?: number;
    /** Nothing to draw: the body says so once instead of an empty chart. */
    empty?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="tile" style="--span: {span}">
  <header>
    <h3>{title}</h3>
    {#if meta}<span class="meta">{meta}</span>{/if}
  </header>
  <div class="body">
    {#if empty}
      <span class="empty">no data</span>
    {:else}
      {@render children()}
    {/if}
  </div>
</section>

<style>
  .tile {
    grid-column: span var(--span);
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    min-width: 0;
    min-height: 0;
  }

  /* The rule under the title is the tile's only edge: it says where a chart
     starts without boxing it in. */
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--pad-3);
    padding-bottom: var(--pad-2);
    border-bottom: 1px solid color-mix(in srgb, var(--muted) 45%, transparent);
  }
  h3 {
    margin: 0;
    min-width: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  /* A size container, so a chart inside can size itself to what is left of
     the tile rather than to its own content. */
  .body {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    container-type: size;
  }
  .empty {
    margin: auto;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
