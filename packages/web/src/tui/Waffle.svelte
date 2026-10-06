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

<!-- Every item is a grid of `total` cells with `yes` of them lit: a share told
     as a count of things, which a bar cannot do. -->
<div class="waffles">
  {#each items as it (it.key)}
    {@const size = boxes[it.key] ?? { w: 0, h: 0 }}
    {@const g = waffleGrid(size.w, size.h, it.total, gap)}
    <figure class="item">
      <div class="box" use:measureBox={(w, h) => (boxes[it.key] = { w, h })}>
        {#if g.size > 0}
          <svg
            width={g.cols * (g.size + g.gap) - g.gap}
            height={g.rows * (g.size + g.gap) - g.gap}
            role="img"
            aria-label="{it.label}: {it.yes} of {it.total}"
          >
            {#each { length: it.total } as _, i (i)}
              {@const c = waffleCell(g, i)}
              <rect
                x={c.x}
                y={c.y}
                width={g.size}
                height={g.size}
                rx={round ? g.size / 2 : 2}
                class:lit={i < it.yes}
                style="--tone-color: {toneVar(it.tone ?? 'warn')}"
              />
            {/each}
          </svg>
        {/if}
      </div>
      <span class="pct" style="color: {toneVar(it.tone ?? 'warn')}"
        >{waffleShare(it.yes, it.total)}%</span
      >
      <figcaption>
        {it.label}
        {#if it.note}<span class="note">{it.note}</span>{/if}
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
