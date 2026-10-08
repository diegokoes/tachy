<script lang="ts">
  import { measureBox } from "./fit";
  import { toneVar } from "./scale";
  import type { Tone } from "./tone";
  import { waffleCell, waffleGrid, waffleShare } from "./waffle";

  export type WaffleItem = {
    key: string;
    label: string;
    /** How many of `total` are lit. */
    yes: number;
    total: number;
    tone?: Tone;
    /** Under the caption, in figures: "815 of 853". */
    note?: string;
  };

  let {
    items,
    gap = 2,
    round = true,
  }: {
    items: WaffleItem[];
    gap?: number;
    /** Dots rather than squares. */
    round?: boolean;
  } = $props();

  let boxes = $state<Record<string, { w: number; h: number }>>({});
</script>

<!--
@component
Every item is a grid of `total` cells with `yes` of them lit: a share told as a
count of things, which a bar cannot do.
-->
<div class="waffles">
  {#each items as item (item.key)}
    {@const size = boxes[item.key] ?? { w: 0, h: 0 }}
    {@const grid = waffleGrid(size.w, size.h, item.total, gap)}
    <figure class="item">
      <div class="box" use:measureBox={(w, h) => (boxes[item.key] = { w, h })}>
        {#if grid.size > 0}
          <svg
            width={grid.cols * (grid.size + grid.gap) - grid.gap}
            height={grid.rows * (grid.size + grid.gap) - grid.gap}
            role="img"
            aria-label="{item.label}: {item.yes} of {item.total}"
          >
            {#each { length: item.total } as _, i (i)}
              {@const cell = waffleCell(grid, i)}
              <rect
                x={cell.x}
                y={cell.y}
                width={grid.size}
                height={grid.size}
                rx={round ? grid.size / 2 : 2}
                class:lit={i < item.yes}
                style="--tone-color: {toneVar(item.tone ?? 'warn')}"
              />
            {/each}
          </svg>
        {/if}
      </div>
      <span class="pct" style="color: {toneVar(item.tone ?? 'warn')}"
        >{waffleShare(item.yes, item.total)}%</span
      >
      <figcaption>
        {item.label}
        {#if item.note}<span class="note">{item.note}</span>{/if}
      </figcaption>
    </figure>
  {/each}
</div>

<style>
  .waffles {
    display: flex;
    gap: var(--pad-4);
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .item {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-1);
    margin: 0;
  }
  .box {
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  svg {
    display: block;
    flex: none;
  }
  rect {
    fill: color-mix(in srgb, var(--muted) 30%, transparent);
  }
  rect.lit {
    fill: var(--tone-color);
  }
  .pct {
    font-family: var(--font-mono);
    font-size: var(--fs-fig);
    line-height: 1.1;
  }
  .note {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
    opacity: 0.8;
  }
  figcaption {
    max-width: 100%;
    font-size: var(--fs-xs);
    color: var(--muted);
    text-align: center;
  }
</style>
