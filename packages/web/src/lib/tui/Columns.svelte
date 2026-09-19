<script lang="ts">
  import { growBar } from "../motion";
  import type { Tone } from "./tone";

  /** `Col`, not `Column` — the tui barrel already exports a table Column. */
  export type Col = {
    key: string;
    label: string;
    value: number;
    tone?: Tone;
    /** Stacks the column, bottom first. Their sum is `value`. */
    parts?: { key: string; value: number; tone: Tone }[];
    /** Spelled out on hover, where the label is only a day of the month. */
    title?: string;
    /** Printed on top instead of the value — "fail" on a run that has none. */
    text?: string;
  };

  let {
    rows,
    max,
    height = "7rem",
    fill = false,
    format = (n: number) => n.toLocaleString(),
    legend,
  }: {
    rows: Col[];
    /** Shared scale. Defaults to the largest row, so the tallest is always full. */
    max?: number;
    height?: string;
    /** Take the parent's whole height instead of `height`. */
    fill?: boolean;
    /** How a column's count is printed — compact, for figures in the millions. */
    format?: (n: number) => string;
    /** The stacked parts, named once under the plot. */
    legend?: { key: string; label: string; tone: Tone }[];
  } = $props();

  const peak = $derived(Math.max(0, ...rows.map((r) => r.value)));
  const top = $derived(max ?? Math.max(1, peak));
  /* A long run gets a number on its peak and its latest column only; every
     other value is on hover. Fourteen numbers over fourteen bars is a row of
     text, not a chart. */
  const dense = $derived(rows.length > 8);
  const count = (r: Col, i: number) =>
    r.text ??
    (r.value && (!dense || i === rows.length - 1 || r.value === peak)
      ? format(r.value)
      : null);
</script>

<!-- The count rides on top of each column and the name below it, so every value
     is readable without hovering and the plot needs no gridlines to be scaled. -->
<div class="chart" class:fill>
  <div class="columns" class:dense style="--plot: {height}">
    {#each rows as r, i (r.key)}
      {@const n = count(r, i)}
      <div class="col {r.tone ?? 'accent'}" title="{r.title ?? r.label}: {r.text ?? format(r.value)}">
        <span class="plot">
          <span
            class="bar"
            class:stacked={Boolean(r.parts)}
            use:growBar={{ pct: (r.value / top) * 100, delay: i * 0.04 }}
          >
            {#if n}<span class="n">{n}</span>{/if}
            {#each (r.parts ?? []).filter((p) => p.value > 0) as p (p.key)}
              <span class="part {p.tone}" style="flex-grow: {p.value}"></span>
            {/each}
          </span>
        </span>
        <span class="lbl">{r.label}</span>
      </div>
    {/each}
  </div>
  {#if legend?.length}
    <div class="legend">
      {#each legend as l (l.key)}
        <span class="key {l.tone}">{l.label}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chart {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    width: 100%;
    min-width: 0;
  }
  .chart.fill {
    height: 100%;
    min-height: 0;
  }

  .columns {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: var(--pad-2);
    width: 100%;
    min-width: 0;
    /* The label band is inside the box on purpose: a container sized to the
       plot alone crops its own axis and grows a nested scrollbar. */
    padding-bottom: var(--pad-1);
    border-bottom: 1px solid var(--border);
  }
  .columns.dense {
    gap: 3px;
  }
  /* Stretched, so each column has a definite height for its plot to take the
     rest of — a column sized to its content has no height for a percentage. */
  .fill .columns {
    flex: 1 1 0;
    min-height: 0;
    align-items: stretch;
  }

  .col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: var(--pad-1);
  }

  /* Hung off the top of the bar, so it rides the column up as it grows. */
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

  /* The top padding is headroom for the count, so the tallest column's count
     stays inside the plot rather than riding up over whatever is above it. */
  .plot {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    width: 100%;
    height: var(--plot);
    padding-top: calc(var(--fs-xs) * 1.6 + var(--pad-2));
  }
  .fill .plot {
    flex: 1 1 0;
    height: auto;
    min-height: 0;
  }
  /* Height is written by growBar, never by CSS — a transition here would race
     the tween and leave the column short. */
  /* Capped, not stretched: three categories across a full-width panel would
     otherwise be three slabs, and a saturated fill that big reads as a colour
     field rather than a measurement. The label under it keeps the full slot. */
  .bar {
    position: relative;
    flex: none;
    width: 100%;
    max-width: 3.25rem;
    min-height: 1px;
    border-radius: 2px 2px 0 0;
    background: var(--tone-color);
  }
  .bar.stacked {
    display: flex;
    flex-direction: column-reverse;
    gap: 2px;
    background: none;
  }
  .part {
    flex-basis: 0;
    min-height: 1px;
    background: var(--tone-color);
  }
  .part:last-child {
    border-radius: 2px 2px 0 0;
  }

  .lbl {
    max-width: 100%;
    font-size: var(--fs-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 var(--pad-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .key::before {
    content: "";
    display: inline-block;
    width: 0.42em;
    height: 0.85em;
    margin-right: var(--pad-1);
    vertical-align: middle;
    border-radius: 1px;
    background: var(--tone-color);
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
  .info {
    --tone-color: var(--info);
  }
</style>
