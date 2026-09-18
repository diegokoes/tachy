<script lang="ts">
  import { growBar } from "../motion";

  /** `Col`, not `Column` — the tui barrel already exports a table Column. */
  export type Col = {
    key: string;
    label: string;
    value: number;
    tone?: "accent" | "ok" | "warn" | "danger" | "muted";
  };

  let {
    rows,
    max,
    height = "7rem",
    format = (n: number) => n.toLocaleString(),
  }: {
    rows: Col[];
    /** Shared scale. Defaults to the largest row, so the tallest is always full. */
    max?: number;
    height?: string;
    /** How a column's count is printed — compact, for figures in the millions. */
    format?: (n: number) => string;
  } = $props();

  const top = $derived(max ?? Math.max(1, ...rows.map((r) => r.value)));
</script>

<!-- The count rides on top of each column and the name below it, so every value
     is readable without hovering and the plot needs no gridlines to be scaled. -->
<div class="columns" style="--plot: {height}">
  {#each rows as r, i (r.key)}
    <div class="col {r.tone ?? 'accent'}">
      <span class="plot">
        <span
          class="fill"
          use:growBar={{ pct: (r.value / top) * 100, delay: i * 0.1 }}
        >
          <span class="n">{format(r.value)}</span>
        </span>
      </span>
      <span class="lbl" title={r.label}>{r.label}</span>
    </div>
  {/each}
</div>

<style>
  .columns {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: var(--pad-3);
    width: 100%;
    min-width: 0;
    /* The label band is inside the box on purpose: a container sized to the
       plot alone crops its own axis and grows a nested scrollbar. */
    padding-bottom: var(--pad-1);
    border-bottom: 1px solid var(--border);
  }

  /* Capped, not stretched: three categories across a full-width panel would
     otherwise be three slabs, and a saturated fill that big reads as a colour
     field rather than a measurement. */
  .col {
    flex: 1 1 0;
    max-width: 4.5rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-1);
  }

  /* Hung off the top of the fill, so it rides the column up as it grows. */
  .n {
    position: absolute;
    bottom: calc(100% + var(--pad-1));
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-xs);
    color: var(--text);
  }

  /* The top padding is headroom for the count. A fill's percentage resolves
     against the content box, so a full-height column plus its count still fits
     inside the plot — before, the count of the tallest column rode up out of it
     and over the chart's title. */
  .plot {
    display: flex;
    align-items: flex-end;
    width: 100%;
    height: var(--plot);
    padding-top: calc(var(--fs-xs) * 1.6 + var(--pad-2));
  }
  /* Height is written by growBar, never by CSS — a transition here would race
     the tween and leave the column short. */
  .fill {
    position: relative;
    flex: none;
    width: 100%;
    min-height: 1px;
    border-radius: 1px 1px 0 0;
    background: var(--tone-color);
  }

  .lbl {
    max-width: 100%;
    font-size: var(--fs-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .accent {
    --tone-color: var(--accent);
  }
  .ok {
    --tone-color: var(--ok);
  }
  .warn {
    --tone-color: var(--warn);
  }
  .danger {
    --tone-color: var(--danger);
  }
  .muted {
    --tone-color: var(--muted);
  }
</style>
