<script lang="ts">
  import {
    hierarchy,
    treemap,
    type HierarchyNode,
    type HierarchyRectangularNode,
  } from "d3-hierarchy";
  import { measureBox, typeSize } from "./fit";
  import type { Block } from "./marks";
  import { heatFill, heatStep, hottest } from "./scale";

  let {
    root,
    max,
    format = (n: number) => n.toLocaleString(),
    onpick,
    bare = false,
    edges = false,
  }: {
    /** The frame: its children are drawn, not itself. */
    root: Block;
    /**
     * Top of the heat scale. Defaults to the hottest leaf; a part of a larger
     * tree takes the whole tree's, so a shade is the same count at every zoom.
     */
    max?: number;
    format?: (n: number) => string;
    /** Given, each group is a button. Leaves stay marks. */
    onpick?: (block: Block) => void;
    /** Shapes only: no names, counts or hover titles, as a preview. */
    bare?: boolean;
    /** Frames without their fill, to lay crisp over a softened copy. */
    edges?: boolean;
  } = $props();

  // Line height and monospace advance, in ems of --fs-xs.
  const LINE = 1.4;
  const CHAR_EM = 0.6;
  // Ramp steps from here up are dark enough to want the ground as ink.
  const INVERSE_STEP = 3;

  type Laid = HierarchyRectangularNode<Block>;

  let w = $state(0);
  let h = $state(0);

  const type = $derived.by(() => {
    void w;
    void h;
    return typeSize();
  });

  const top = $derived(max ?? hottest(root));

  // A group gets a header and frame only where its box can name it and still
  // show what is under it. d3 positions a node before asking for its padding,
  // so the call is made on the box the group got.
  const laid = $derived.by(() => {
    const heads = new Set<HierarchyNode<Block>>();
    if (!(w > 0 && h > 0)) return { nodes: [] as Laid[], heads };
    const { fs } = type;
    const line = fs * LINE;
    const gap = Math.max(1, Math.round(type.rem * 0.15));
    const head = Math.ceil(line + gap * 3);
    const judged = new Map<HierarchyNode<Block>, boolean>();
    const titled = (n: Laid) => {
      let fits = judged.get(n);
      if (fits === undefined) {
        fits =
          !bare &&
          n.depth > 0 &&
          n.x1 - n.x0 >= fs * CHAR_EM * 4 + gap * 2 &&
          n.y1 - n.y0 >= head + line * 2;
        judged.set(n, fits);
        if (fits) heads.add(n);
      }
      return fits;
    };
    const edge = (n: Laid) => (titled(n) ? gap : 0);
    const tree = hierarchy(root)
      .sum((b) => (b.children?.length ? 0 : (b.size ?? 1)))
      .sort(
        (a, b) =>
          (b.value ?? 0) - (a.value ?? 0) ||
          a.data.label.localeCompare(b.data.label),
      );
    const layout = treemap<Block>()
      .size([w, h])
      .round(true)
      .paddingInner((n) => (n.depth ? gap : gap * 4))
      .paddingLeft(edge)
      .paddingRight(edge)
      .paddingBottom(edge)
      .paddingTop((n) => (titled(n) ? head : 0))(tree);
    return { nodes: layout.descendants().slice(1), heads };
  });

  const tip = (b: Block) => b.title ?? `${b.label}: ${format(b.value)}`;

  /** Which lines of a leaf's label its box holds: none, the name, or both. */
  function lines(n: Laid): 0 | 1 | 2 {
    if (bare) return 0;
    const { fs, rem } = type;
    const line = fs * LINE;
    const wide = n.x1 - n.x0 - rem * 0.6 >= fs * CHAR_EM * 3;
    const tall = n.y1 - n.y0 - rem * 0.3;
    if (!wide || tall < line) return 0;
    return tall >= line * 2 ? 2 : 1;
  }
</script>

{#snippet header(n: Laid)}
  <span class="head">
    <span class="name">{n.data.label}</span>
    <span class="n">{format(n.data.value)}</span>
  </span>
{/snippet}

<div
  class="map"
  use:measureBox={(nw, nh) => {
    w = nw;
    h = nh;
  }}
>
  {#each laid.nodes as n (n.data.key)}
    {@const place = `left: ${n.x0}px; top: ${n.y0}px; width: ${n.x1 - n.x0}px; height: ${n.y1 - n.y0}px`}
    {#if n.x1 - n.x0 >= 1 && n.y1 - n.y0 >= 1}
      {#if n.children && !laid.heads.has(n)}
        <!-- Unnamed: its leaves carry the whole path on hover. -->
      {:else if n.children && onpick}
        <button
          type="button"
          class="block group"
          style={place}
          title={tip(n.data)}
          aria-label={tip(n.data)}
          onclick={() => onpick(n.data)}>{@render header(n)}</button
        >
      {:else if n.children}
        <div class="block group" style={place} title={tip(n.data)}>
          {@render header(n)}
        </div>
      {:else}
        {@const shown = lines(n)}
        <div
          class="block leaf"
          class:bare={!shown && !edges}
          class:edges
          class:hollow={!(n.data.value > 0)}
          class:inverse={heatStep(n.data.value, top) >= INVERSE_STEP}
          style="{place}; background: {edges
            ? 'none'
            : heatFill(n.data.value, top)}"
          title={bare ? undefined : tip(n.data)}
        >
          {#if shown}<span class="name">{n.data.label}</span>{/if}
          {#if shown === 2}<span class="n">{format(n.data.value)}</span>{/if}
        </div>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .map {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.4;
  }

  /* Absolutely placed and keyed, so a zoom moves the blocks it keeps from
     where they were to where they land instead of redrawing them. */
  .block {
    position: absolute;
    box-sizing: border-box;
    margin: 0;
    border-radius: 2px;
    overflow: hidden;
    transition:
      left 0.24s ease,
      top 0.24s ease,
      width 0.24s ease,
      height 0.24s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .block {
      transition: none;
    }
  }

  /* A column from the top: a button centres its content otherwise, and the
     header would sit under the children drawn over it. */
  .group {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--muted) 40%, transparent);
    background: none;
    color: var(--muted);
    font: inherit;
    text-align: left;
  }
  button.group {
    cursor: zoom-in;
  }
  button.group:hover,
  button.group:focus-visible {
    border-color: var(--text);
    color: var(--text);
    outline: none;
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 1ch;
    padding: 0 0.3rem;
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
  }

  .leaf {
    display: flex;
    flex-direction: column;
    padding: 0.15rem 0.3rem;
    border: 1px solid color-mix(in srgb, var(--series) 35%, transparent);
    color: var(--text);
  }
  /* Too small to name: the fill alone reads better than a grid of edges. */
  .leaf.bare {
    border-color: transparent;
  }
  /* Nothing filed: the frame without the fill, which is the point of drawing
     it at all. */
  .leaf.hollow {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--muted) 55%, transparent);
    color: var(--muted);
  }
  .leaf.edges {
    border-color: color-mix(in srgb, var(--series) 70%, transparent);
  }
  .leaf.inverse {
    color: var(--bg);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .n {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
</style>
