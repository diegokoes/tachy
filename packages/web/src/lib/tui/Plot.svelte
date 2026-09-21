<script lang="ts" module>
  import { getContext } from "svelte";

  export type Pad = { top: number; right: number; bottom: number; left: number };

  export type Frame = {
    /** False until the box has been measured. Nothing draws before then. */
    ready: boolean;
    /** Outer box, in px. */
    w: number;
    h: number;
    /** The plot area inside the gutters, in px. */
    iw: number;
    ih: number;
    pad: Pad;
    /** One category's slot, and the bar drawn inside it, in px. */
    step: number;
    band: number;
    /** Where a category's band starts, in px from the plot area's left edge. */
    bandAt: (key: string) => number;
    /** Where a value sits, in px from the plot area's TOP edge. */
    at: (v: number) => number;
    /** How tall a span of `v` is, in px. */
    up: (v: number) => number;
    /** The value axis, after rounding. */
    domain: [number, number];
    /** The values the axis labels. */
    ticks: number[];
    /** Base font size, px: what the gutters and the tick budget were sized from. */
    fs: number;
    /** The root font size in px, for a mark with a rem-authored limit to honour. */
    rem: number;
  };

  export const PLOT_KEY = Symbol("plot");

  /**
   * The plot a mark is drawn in. Call at init and read `.frame` from a
   * `$derived`: the holder is what makes the frame stay live, and getContext
   * itself may only run while the component is initialising.
   */
  export const getPlot = (): { readonly frame: Frame } => {
    const held = getContext<{ frame: Frame } | undefined>(PLOT_KEY);
    if (!held) throw new Error("a plot mark must be inside <Plot>");
    return held;
  };
</script>

<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import { measureBox } from "./fit";
  import { gutterPx, niceDomain, tickCount, tickValues, TICK_LEN } from "./scale";

  let {
    categories,
    max,
    /** Formats a value for the left gutter, so the gutter is sized to what it will hold. */
    format = (n: number) => n.toLocaleString(),
    height,
    padding = 0.22,
    /** No headroom above the plot, for a mark that prints nothing over itself. */
    flush = false,
    children,
  }: {
    /** The bottom axis' bands, in drawing order. */
    categories: string[];
    /** Top of the value axis, before rounding. */
    max: number;
    format?: (n: number) => string;
    /** A fixed plot height. Omitted, the plot fills its parent. */
    height?: string;
    /** Share of a slot left as gap, 0–1. */
    padding?: number;
    flush?: boolean;
    children: Snippet<[Frame]>;
  } = $props();

  let w = $state(0);
  let h = $state(0);

  /**
   * The px value of --fs-xs.
   *
   * Custom properties are not resolved by the cascade, so the token comes back
   * as the string it was authored in ("0.72rem") and has to be multiplied by
   * the root size by hand. Keyed on the measured box, which is not as indirect
   * as it looks: the root size is itself a `clamp()` on vw, and the font-scale
   * setting rewrites it, so anything that changes it reflows this box too.
   */
  const type = $derived.by(() => {
    void w;
    void h;
    if (typeof window === "undefined") return { fs: 12, rem: 16 };
    const root = getComputedStyle(document.documentElement);
    const rem = parseFloat(root.fontSize) || 16;
    const token = root.getPropertyValue("--fs-xs").trim();
    const n = parseFloat(token);
    if (!Number.isFinite(n)) return { fs: rem * 0.72, rem };
    return { fs: token.endsWith("px") ? n : n * rem, rem };
  });
  const fs = $derived(type.fs);

  const frame = $derived.by((): Frame => {
    const domain = niceDomain(max, 4);
    const ticks = tickValues(domain[0], domain[1], tickCount(Math.max(0, h), fs));
    const pad: Pad = {
      /* Headroom for the value a column prints above itself, the same
         allowance the flex version reserved with its padding-top. */
      top: flush ? 0 : Math.round(fs * 1.6),
      right: 0,
      bottom: Math.round(fs * 1.6) + TICK_LEN,
      left: gutterPx(ticks.map(format), fs),
    };
    const iw = Math.max(0, w - pad.left - pad.right);
    const ih = Math.max(0, h - pad.top - pad.bottom);
    const step = categories.length ? iw / categories.length : iw;
    const band = Math.max(1, step * (1 - padding));
    const index = new Map(categories.map((k, i) => [k, i]));
    const span = domain[1] - domain[0] || 1;
    const up = (v: number) => (Math.max(0, v) / span) * ih;
    return {
      ready: w > 0 && h > 0,
      w,
      h,
      iw,
      ih,
      pad,
      step,
      band,
      bandAt: (key) => (index.get(key) ?? 0) * step + (step - band) / 2,
      at: (v) => ih - up(v),
      up,
      domain,
      ticks,
      fs,
      rem: type.rem,
    };
  });

  /* Set once during init, as context must be. The getter is what keeps the
     value live as the box is measured. */
  setContext(PLOT_KEY, {
    get frame() {
      return frame;
    },
  });
</script>

<!-- The SVG is taken out of flow on purpose. Tile's body is
     `container-type: size`, so a child that contributed its own height back to
     the box it is measured against would oscillate. -->
<div
  class="plot"
  class:fill={!height}
  style={height ? `height: ${height}` : undefined}
  use:measureBox={(nw, nh) => {
    w = nw;
    h = nh;
  }}
>
  {#if frame.ready}
    <svg viewBox="0 0 {frame.w} {frame.h}" role="presentation">
      <g transform="translate({frame.pad.left}, {frame.pad.top})">
        {@render children(frame)}
      </g>
    </svg>
  {/if}
</div>

<style>
  .plot {
    position: relative;
    width: 100%;
    min-width: 0;
    overflow: hidden;
  }
  .plot.fill {
    flex: 1 1 0;
    min-height: 0;
  }
  svg {
    display: block;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
</style>
