<script lang="ts">
  import { growBar } from "../motion";

  export type Bar = { key: string; label: string; value: number };

  let {
    rows,
    limit = 8,
    unit = "",
  }: {
    /** Drawn in the order given; the caller sorts. */
    rows: Bar[];
    /** Rows past this fold into one "more" line, so a long tail cannot push the panel off the page. */
    limit?: number;
    unit?: string;
  } = $props();

  const top = $derived(Math.max(1, ...rows.map((r) => r.value)));
  const shown = $derived(rows.length > limit + 1 ? rows.slice(0, limit) : rows);
  const rest = $derived(rows.slice(shown.length));
  const restTotal = $derived(rest.reduce((sum, r) => sum + r.value, 0));
</script>

<!-- Name, bar, count on every row: the scale is the numbers themselves, so the
     plot needs no axis and nothing is hidden behind a hover. -->
<div class="bars">
  {#each shown as r, i (r.key)}
    <div class="row">
      <span class="lbl" title={r.label}>{r.label}</span>
      <span class="track">
        <span
          class="fill"
          use:growBar={{ pct: (r.value / top) * 100, delay: i * 0.05, along: "width" }}
        ></span>
      </span>
      <span class="n">{r.value.toLocaleString()}</span>
    </div>
  {/each}
  {#if rest.length}
    <div class="row more">
      <span class="lbl">{rest.length} more</span>
      <span class="track"></span>
      <span class="n">{restTotal.toLocaleString()}{unit && ` ${unit}`}</span>
    </div>
  {/if}
</div>

<style>
  .bars {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    width: 100%;
    min-width: 0;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(6rem, 14rem) minmax(0, 1fr) 3.5rem;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-xs);
  }
  .lbl {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    position: relative;
    height: 0.5rem;
    min-width: 0;
  }
  /* Width is written by growBar, never by CSS — a transition would race the tween. */
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    min-width: 1px;
    border-radius: 1px;
    background: var(--accent);
  }
  .n {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    text-align: right;
    white-space: nowrap;
  }
  .more .n {
    grid-column: 2 / 4;
    color: var(--muted);
  }
  .more .track {
    display: none;
  }
</style>
