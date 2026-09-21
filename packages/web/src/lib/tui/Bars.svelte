<script lang="ts">
  import { fitRows, fitted } from "./fit";
  import type { Bar } from "./marks";
  import { toneVar } from "./scale";

  const ROW_REM = 1.25;
  const GAP_REM = 0.2;

  let {
    rows,
    limit = 8,
    fit = false,
    unit = "",
    format = (n: number) => n.toLocaleString(),
    sum = true,
    onpick,
  }: {
    /** Drawn in the order given; the caller sorts. */
    rows: Bar[];
    /** Rows past this fold into one "more" line, so a long tail cannot push the panel off the page. */
    limit?: number;
    /** Show as many rows as the parent's height holds instead of `limit`. */
    fit?: boolean;
    unit?: string;
    format?: (n: number) => string;
    /** Whether the "more" row totals the rows it folds; not for averages. */
    sum?: boolean;
    /** Given, each row's label is a link to what the row counts. */
    onpick?: (bar: Bar) => void;
  } = $props();

  let room = $state(0);

  const top = $derived(Math.max(1, ...rows.map((r) => r.value)));
  const cut = $derived(fitted(rows, fit ? room : limit + 1));
  const restTotal = $derived(cut.rest.reduce((n, r) => n + r.value, 0));
</script>

<!-- Name, bar, count on every row: the scale is the numbers themselves, so the
     plot needs no axis and nothing is hidden behind a hover. -->
<div
  class="bars"
  class:fit
  style="--row: {ROW_REM}rem; --gap: {GAP_REM}rem"
  use:fitRows={{ row: ROW_REM, gap: GAP_REM, onfit: (n) => (room = n) }}
>
  {#each cut.shown as r (r.key)}
    <div class="row" style="--tone-color: {toneVar(r.tone)}">
      {#if onpick}
        <button class="lbl pick" title={r.label} onclick={() => onpick(r)}
          >{r.label}</button
        >
      {:else}
        <span class="lbl" title={r.label}>{r.label}</span>
      {/if}
      <span class="track">
        <span
          class="fill"
          class:stacked={Boolean(r.parts)}
          style="width: {(r.value / top) * 100}%"
        >
          {#each (r.parts ?? []).filter((p) => p.value > 0) as p (p.key)}
            <span
              class="part"
              style="flex-grow: {p.value}; --tone-color: {toneVar(p.tone)}"
            ></span>
          {/each}
        </span>
      </span>
      <span class="n">{format(r.value)}</span>
    </div>
  {/each}
  {#if cut.rest.length}
    <div class="row more">
      <span class="lbl">{cut.rest.length} more</span>
      {#if sum}<span class="n">{format(restTotal)}{unit && ` ${unit}`}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .bars {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    width: 100%;
    min-width: 0;
  }
  .bars.fit {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(4rem, 38%) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--pad-2);
    height: var(--row);
    flex: none;
    font-size: var(--fs-xs);
  }
  .lbl {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pick {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pick:hover,
  .pick:focus-visible {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .track {
    position: relative;
    height: 0.5rem;
    min-width: 0;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    min-width: 1px;
    border-radius: 0 2px 2px 0;
    background: var(--tone-color);
  }
  .fill.stacked {
    display: flex;
    gap: 2px;
    background: none;
  }
  .part {
    flex-basis: 0;
    min-width: 1px;
    background: var(--tone-color);
  }
  .n {
    min-width: 2.5rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    text-align: right;
    white-space: nowrap;
  }
  .more {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .more .n {
    color: var(--muted);
  }
</style>
