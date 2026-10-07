<script lang="ts">
  import { fitRows, fitted } from "./fit";
  import Legend from "./Legend.svelte";
  import type { Bar, LegendItem } from "./marks";
  import { toneVar } from "./scale";
  import { getView } from "./view";

  const ROW_REM = 1.25;
  const GAP_REM = 0.2;

  let {
    rows,
    cap = 8,
    unit = "",
    format = (n: number) => n.toLocaleString(),
    sum = true,
    onpick,
    legend,
  }: {
    /** Drawn in the order given; the caller sorts. */
    rows: Bar[];
    /** Rows past this fold into one "more" line where the chart is not in a tile; in one, the tile's height decides. */
    cap?: number;
    unit?: string;
    format?: (n: number) => string;
    /** Whether the "more" row totals the rows it folds; not for averages. */
    sum?: boolean;
    /** Given, each row's label is a link to what the row counts. */
    onpick?: (bar: Bar) => void;
    /** Names the parts of a stacked bar once, under the rows. */
    legend?: LegendItem[];
  } = $props();

  const view = getView();
  let room = $state(0);

  const top = $derived(Math.max(1, ...rows.map((r) => r.value)));
  const cut = $derived(
    fitted(rows, view.expanded ? Infinity : view.tiled ? room : cap),
  );
  const hasAside = $derived(rows.some((r) => r.aside));
  const restTotal = $derived(cut.rest.reduce((n, r) => n + r.value, 0));

  $effect(() => view.fold?.(cut.rest.length > 0));
</script>

<!--
@component
Name, bar, count on every row: the scale is the numbers themselves, so the plot
needs no axis and nothing is hidden behind a hover.
-->
<div
  class="list"
  class:all={view.expanded}
  class:fit={view.tiled && !view.expanded}
>
  <div
    class="room"
    use:fitRows={{
      row: ROW_REM,
      gap: GAP_REM,
      onfit: (n) => (room = n),
    }}
  >
    <div
      class="bars"
      class:big={view.expanded}
      style="--row: {view.expanded
        ? ROW_REM * 1.5
        : ROW_REM}rem; --gap: {GAP_REM}rem"
    >
      {#each cut.shown as row (row.key)}
        <div
          class="row"
          class:with-aside={hasAside}
          style="--tone-color: {toneVar(row.tone)}"
        >
          {#if onpick}
            <button class="lbl pick" onclick={() => onpick(row)}
              >{row.label}</button
            >
          {:else}
            <span class="lbl">{row.label}</span>
          {/if}
          <span class="track">
            <span
              class="fill"
              class:stacked={Boolean(row.parts)}
              style="width: {(row.value / top) * 100}%"
            >
              {#each (row.parts ?? []).filter((p) => p.value > 0) as part (part.key)}
                <span
                  class="part"
                  style="flex-grow: {part.value}; --tone-color: {toneVar(
                    part.tone,
                  )}"
                ></span>
              {/each}
              {#if row.inner?.length}
                <span
                  class="inner"
                  style="width: {(row.inner.reduce((n, p) => n + p.value, 0) /
                    row.value) *
                    100}%"
                >
                  {#each row.inner.filter((p) => p.value > 0) as part (part.key)}
                    <span
                      class="part"
                      style="flex-grow: {part.value}; --tone-color: {toneVar(
                        part.tone,
                      )}"
                    ></span>
                  {/each}
                </span>
              {/if}
            </span>
          </span>
          <span class="n">{format(row.value)}</span>
          {#if hasAside}<span class="aside">{row.aside ?? ""}</span>{/if}
        </div>
      {/each}
      {#if cut.rest.length}
        <div class="row more">
          {#if view.open}
            <button class="lbl pick" onclick={() => view.open?.()}
              >{cut.rest.length} more</button
            >
          {:else}
            <span class="lbl">{cut.rest.length} more</span>
          {/if}
          {#if sum}<span class="n">{format(restTotal)}{unit && ` ${unit}`}</span
            >{/if}
        </div>
      {/if}
    </div>
  </div>
  {#if legend && rows.some((r) => r.parts || r.inner)}<Legend
      items={legend}
    />{/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    width: 100%;
    min-width: 0;
  }
  .list.fit,
  .list.all {
    height: 100%;
    min-height: 0;
  }
  .room {
    flex: 1 1 auto;
    min-height: 0;
  }
  .list.fit .room {
    flex: 1 1 0;
    overflow: hidden;
  }
  .list.all .room {
    flex: 1 1 0;
    overflow-y: auto;
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    width: 100%;
    min-width: 0;
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
  .big .row {
    font-size: var(--fs-sm);
  }
  .big .track {
    height: 0.8rem;
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
  .inner {
    position: absolute;
    inset: 30% auto 30% 0;
    min-width: 3px;
    display: flex;
    gap: 1px;
    border-radius: 0 1px 1px 0;
    box-shadow: 0 0 0 1.5px var(--panel-solid);
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
  .row.with-aside {
    grid-template-columns: minmax(4rem, 38%) minmax(0, 1fr) auto auto;
  }
  .aside {
    min-width: 3.5rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
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
