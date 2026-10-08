<script lang="ts">
  import { onMount } from "svelte";
  import { utcTip } from "../dates.svelte";
  import { breathe, driftMarks, focusLane } from "../motion/motion";
  import { fitRows, fitted } from "./fit";
  import { clock, hourMarks, isSoon, nextIndex, until } from "./timeline";
  import { getView } from "./view";

  export type Lane = { key: string; label: string; at: string[] };

  const DRIFT_PX = 32;
  const ROW_REM = 1.25;
  const GAP_REM = 0.2;

  let {
    lanes,
    from,
    hours = 24,
  }: {
    lanes: Lane[];
    /** The left edge of the axis. */
    from: Date;
    hours?: number;
  } = $props();

  const view = getView();
  let room = $state(0);
  let root: HTMLElement | undefined = $state();
  let now = $state(Date.now());

  // The countdowns are minutes apart, so they need no more than a slow beat.
  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  const span = $derived(hours * 3_600_000);
  const pos = (iso: string) =>
    ((Date.parse(iso) - from.getTime()) / span) * 100;
  const cut = $derived(
    fitted(lanes, view.expanded ? Infinity : Math.max(1, room - 1)),
  );
  // The right edge is left unlabelled: a clock time there crowds its neighbour,
  // and the tile's title already says how far the axis runs.
  const marks = $derived([
    { at: 0, label: "now" },
    ...hourMarks(from, hours).filter((m) => m.at > 8 && m.at < 96),
  ]);

  function tickClass(iso: string, next: boolean): string {
    if (next) return "next";
    if (Date.parse(iso) < now) return "past";
    return isSoon(iso, now) ? "soon" : "";
  }

  const ticksOf = (lane: Element) => [...lane.querySelectorAll(".tick")];
  const lanesOf = () =>
    root ? [...root.querySelectorAll<Element>(".lane.live")] : [];

  // Moving while the board is on screen. Rebuilt when the lanes change, so a
  // lane that appears starts moving with the rest.
  $effect(() => {
    void cut.shown.length;
    if (!root) return;
    const stops = [
      driftMarks([...root.querySelectorAll(".drift")], DRIFT_PX),
      breathe([...root.querySelectorAll(".tick.next")]),
    ];
    return () => stops.forEach((stop) => stop());
  });
</script>

<div
  class="timeline"
  bind:this={root}
  style="--row: {ROW_REM}rem; --gap: {GAP_REM}rem"
  use:fitRows={{ row: ROW_REM, gap: GAP_REM, onfit: (n) => (room = n) }}
  onmouseleave={() => focusLane(lanesOf(), null, ticksOf)}
  role="presentation"
>
  {#each cut.shown as lane (lane.key)}
    {@const next = nextIndex(lane.at, now)}
    <div
      class="lane live"
      onmouseenter={(e) => focusLane(lanesOf(), e.currentTarget, ticksOf)}
      role="presentation"
    >
      <span class="lbl">{lane.label}</span>
      <span class="track">
        {#each marks.slice(1) as mark (mark.at)}
          <span class="rule" style="left: {mark.at}%"></span>
        {/each}
        <span class="drift"></span>
        {#each lane.at as time, i (time)}
          <span
            class="tick {tickClass(time, i === next)}"
            style="left: {pos(time)}%"
            title="{clock(new Date(time))} · {utcTip(time)}"
          ></span>
        {/each}
      </span>
      <span class="n"
        >{lane.at.length}{#if next >= 0}<span class="in"
            >{until(Date.parse(lane.at[next]) - now)}</span
          >{/if}</span
      >
    </div>
  {/each}
  {#if cut.rest.length}
    <div class="lane more">
      <span class="lbl">{cut.rest.length} more</span>
    </div>
  {/if}
  <div class="lane axis">
    <span></span>
    <span class="track">
      {#each marks as mark (mark.at)}
        <span class="mark" style="left: {mark.at}%">{mark.label}</span>
      {/each}
    </span>
    <span></span>
  </div>
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .lane {
    display: grid;
    grid-template-columns: minmax(4rem, 30%) minmax(0, 1fr) 6.5rem;
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
  /* The rail is the day: a hairline for the lane, and a fainter rule at every
     six hours so a firing can be placed against the clock below. The left edge
     is now. */
  .track {
    position: relative;
    height: 100%;
    min-width: 0;
    overflow: hidden;
    background:
      linear-gradient(var(--accent-fill), var(--accent-fill)) left / 1px 100%
        no-repeat,
      linear-gradient(var(--border), var(--border)) center / 100% 1px no-repeat;
  }
  .rule {
    position: absolute;
    inset: 0 auto 0 0;
    width: 1px;
    background: color-mix(in srgb, var(--muted) 22%, transparent);
  }
  /* Little rule marks along the rail, wider than the rail by one step so the
     slide never shows an edge; they are what moves, and they say time passes. */
  .drift {
    position: absolute;
    inset: 38% auto 38% 0;
    width: calc(100% + 32px);
    background: repeating-linear-gradient(
      to right,
      color-mix(in srgb, var(--muted) 40%, transparent) 0 2px,
      transparent 2px 32px
    );
    pointer-events: none;
  }
  .tick {
    position: absolute;
    top: 20%;
    bottom: 20%;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--accent-fill);
    opacity: 0.55;
    transform-origin: 50% 50%;
  }
  .tick.soon {
    opacity: 0.9;
  }
  .tick.next {
    top: 10%;
    bottom: 10%;
    opacity: 1;
  }
  .tick.past {
    opacity: 0.2;
  }
  .n {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: var(--pad-2);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    text-align: right;
    white-space: nowrap;
  }
  .in {
    min-width: 3.4rem;
    color: var(--muted);
  }
  .more .lbl {
    grid-column: 1 / -1;
  }
  .axis {
    margin-top: auto;
  }
  .axis .track {
    background: none;
    overflow: visible;
  }
  .mark {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    color: var(--muted);
    white-space: nowrap;
  }
  .mark:first-child {
    transform: translate(0, -50%);
  }
</style>
