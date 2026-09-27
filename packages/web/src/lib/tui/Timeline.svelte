<script lang="ts">
  import { fitRows, fitted } from "./fit";

  export type Lane = { key: string; label: string; at: string[] };

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

  let room = $state(0);

  const span = $derived(hours * 3_600_000);
  const pos = (iso: string) =>
    ((Date.parse(iso) - from.getTime()) / span) * 100;
  /* One row of the budget goes to the axis. */
  const cut = $derived(fitted(lanes, Math.max(1, room - 1)));
  /* The right edge is left unlabelled: "+24h" there crowds "+18h", and the
     tile's title already says how far the axis runs. */
  const marks = $derived(
    Array.from({ length: 4 }, (_, i) => ({
      at: (i / 4) * 100,
      label: i ? `+${(hours / 4) * i}h` : "now",
    })),
  );
</script>

<div
  class="timeline"
  style="--row: {ROW_REM}rem; --gap: {GAP_REM}rem"
  use:fitRows={{ row: ROW_REM, gap: GAP_REM, onfit: (n) => (room = n) }}
>
  {#each cut.shown as l (l.key)}
    <div class="lane">
      <span class="lbl" title={l.label}>{l.label}</span>
      <span class="track">
        {#each l.at as t (t)}
          <span
            class="tick"
            style="left: {pos(t)}%"
            title={new Date(t).toLocaleString()}
          ></span>
        {/each}
      </span>
      <span class="n">{l.at.length}</span>
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
      {#each marks as m (m.at)}
        <span class="mark" style="left: {m.at}%">{m.label}</span>
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
    grid-template-columns: minmax(4rem, 34%) minmax(0, 1fr) 2rem;
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
  /* The rail is the day; each tick is one firing on it. */
  .track {
    position: relative;
    height: 100%;
    min-width: 0;
    background: linear-gradient(var(--border), var(--border)) center / 100% 1px
      no-repeat;
  }
  .tick {
    position: absolute;
    top: 20%;
    bottom: 20%;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--accent);
  }
  .n {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    text-align: right;
  }
  .more .lbl {
    grid-column: 1 / -1;
  }
  .axis {
    margin-top: auto;
  }
  .axis .track {
    background: none;
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
