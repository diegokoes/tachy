<script lang="ts">
  import { ticks } from "d3-array";
  import { measureBox, typeSize } from "./fit";
  import type { Bar } from "./marks";
  import { CH_EM, toneVar } from "./scale";
  import { waffleBarCell, waffleBarsGrid, waffleCount } from "./waffle";

  let {
    rows,
    format = (n: number) => n.toLocaleString(),
    gap = 2,
  }: {
    rows: Bar[];
    format?: (n: number) => string;
    gap?: number;
  } = $props();

  let w = $state(0);
  let h = $state(0);

  const type = $derived.by(() => {
    void w;
    return typeSize();
  });
  const fs = $derived(type.fs);

  const longest = $derived(
    rows.reduce((n, r) => Math.max(n, r.label.length), 0),
  );
  const biggest = $derived(Math.max(1, ...rows.map((r) => r.value)));
  const valueGutter = $derived(
    Math.ceil(
      Math.max(...rows.map((r) => format(r.value).length), 1) * CH_EM * fs,
    ) + 8,
  );
  const labelGutter = $derived(
    Math.min(Math.ceil(longest * CH_EM * fs) + 10, w * 0.38),
  );
  const axisH = $derived(Math.round(fs * 1.8));
  const grid = $derived(
    waffleBarsGrid(
      w - labelGutter - valueGutter,
      h - axisH,
      rows.length,
      biggest,
      gap,
    ),
  );
  const maxChars = $derived(
    Math.max(3, Math.floor((labelGutter - 10) / (CH_EM * fs))),
  );
  const band = $derived(rows.length ? (h - axisH) / rows.length : 0);
  const span = $derived(grid.cols * grid.per * grid.unit);
  const axis = $derived(
    grid.cols
      ? ticks(
          0,
          span,
          Math.max(
            2,
            Math.min(
              6,
              Math.floor((grid.cols * (grid.size + grid.gap)) / (fs * 6)),
            ),
          ),
        )
      : [],
  );
  const x = (v: number) => (v / grid.unit / grid.per) * (grid.size + grid.gap);
  const cut = (s: string) =>
    s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
</script>

<!--
@component
Every cell is `unit` of the thing: a count read by counting, and the axis is the
same number written out.
-->
<div
  class="waffle-bars"
  use:measureBox={(nw, nh) => {
    w = nw;
    h = nh;
  }}
>
  {#if w > 0 && h > 0 && grid.size > 0}
    <svg viewBox="0 0 {w} {h}" role="img" aria-label="bars of {grid.unit}">
      {#each rows as row, i (row.key)}
        {@const n = waffleCount(row.value, grid.unit)}
        {@const barH = grid.per * (grid.size + grid.gap) - grid.gap}
        {@const y0 = i * band + (band - barH) / 2}
        <g style="--tone-color: {toneVar(row.tone)}">
          <title>{row.label}: {format(row.value)}</title>
          <text class="lbl" x={0} y={y0 + barH / 2} dominant-baseline="middle"
            >{cut(row.label)}</text
          >
          <g transform="translate({labelGutter}, {y0})">
            {#each { length: n } as _, cellIndex (cellIndex)}
              {@const place = waffleBarCell(grid, cellIndex)}
              <rect
                x={place.x}
                y={place.y}
                width={grid.size}
                height={grid.size}
                rx="1.5"
              />
            {/each}
            <text
              class="n"
              x={Math.ceil(n / grid.per) * (grid.size + grid.gap) + 4}
              y={barH / 2}
              dominant-baseline="middle">{format(row.value)}</text
            >
          </g>
        </g>
      {/each}
      <g transform="translate({labelGutter}, {h - axisH})" aria-hidden="true">
        <line class="rule" x1="0" x2={x(span)} y1="0" y2="0" />
        {#each axis as tick (tick)}
          <line class="tick" x1={x(tick)} x2={x(tick)} y1="0" y2="3" />
          <text class="tl" x={x(tick)} y={fs + 4} text-anchor="middle"
            >{format(tick)}</text
          >
        {/each}
      </g>
    </svg>
  {/if}
</div>

<style>
  .waffle-bars {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    overflow: hidden;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  rect {
    fill: var(--tone-color);
  }
  text {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .lbl {
    fill: var(--muted);
  }
  .n {
    fill: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .rule,
  .tick {
    stroke: var(--muted);
    stroke-width: 1;
    opacity: 0.5;
  }
  .tl {
    fill: var(--muted);
  }
</style>
