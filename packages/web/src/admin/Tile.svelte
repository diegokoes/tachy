<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import { Icon, tip } from "../tui";
  import { VIEW_KEY, type TileView } from "../tui/view";
  import { expandedKey, openTile } from "./expand.svelte";
  import { segment } from "../shell/router.svelte";

  let {
    title,
    key,
    meta,
    span = 1,
    size = "share",
    expand = "chart",
    empty = false,
    actions,
    detail,
    children,
  }: {
    title: string;
    /** Given, the chart can be taken out of its tile to the whole window. */
    key?: string;
    /** Right of the title: the window it covers, or its total. */
    meta?: string;
    /** Grid columns it takes. */
    span?: number;
    /** `content` takes only the height its chart needs and leaves the rest to the tile beside it. */
    size?: "share" | "content";
    /**
     * What earns the expand button. A chart always has more to say in the
     * window; a ranked list only has more when it had to cut rows to fit.
     */
    expand?: "chart" | "list";
    /** Nothing to draw: the body says so once instead of an empty chart. */
    empty?: boolean;
    /** Controls at the right of the title: open the detail, run the thing. */
    actions?: Snippet;
    /** What the window shows in place of the tile's chart: figures, the chart larger, the rows behind it. */
    detail?: Snippet;
    children: Snippet;
  } = $props();

  const open = $derived(key !== undefined && expandedKey() === key);
  const page = $derived(segment(1) ?? "integrations");
  let el: HTMLElement | undefined = $state();
  let folded = $state(false);

  const view: TileView = {
    get expanded() {
      return open;
    },
    get tiled() {
      return size === "share";
    },
    open: () => key && openTile(page, key, el ?? null),
    fold: (f) => (folded = f),
  };
  setContext(VIEW_KEY, view);
</script>

<section
  class="tile"
  class:open
  class:content={size === "content"}
  style="--span: {span}"
  data-tile={key}
  bind:this={el}
>
  <header>
    <h3>{title}</h3>
    <span class="side">
      {#if meta && !(open && detail)}<span class="meta">{meta}</span>{/if}
      {#if actions}{@render actions()}{/if}
      {#if key && !open && !empty && (expand === "chart" || folded)}
        <button
          type="button"
          class="expand"
          aria-label="expand {title}"
          use:tip={`expand ${title}`}
          onclick={() => view.open?.()}
          ><Icon name="enlarge" size="1em" /></button
        >
      {/if}
    </span>
  </header>
  <div class="body">
    {#if empty}
      <span class="empty">no data</span>
    {:else if open && detail}
      {@render detail()}
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

  .tile.content {
    flex: none;
  }
  /* A size container has no intrinsic height, so a tile that sizes to its
     content must contain its width only. */
  .tile.content .body {
    flex: none;
    container-type: inline-size;
  }

  .expand {
    display: inline-flex;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .expand:hover,
  .expand:focus-visible {
    color: var(--text);
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
  .side {
    display: inline-flex;
    align-items: baseline;
    gap: var(--pad-2);
    flex: none;
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
