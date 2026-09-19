<script lang="ts">
  import { fitRows } from "./fit";

  export type Cell = {
    key: string;
    label: string;
    tone: "ok" | "warn" | "danger" | "muted";
    /** The reading behind the state — "42%", "keyed by TACHY_SECRET_KEY". */
    title?: string;
  };

  const COLS = 2;
  const ROW_REM = 1.4;
  const GAP_REM = 0.2;

  let { cells }: { cells: Cell[] } = $props();

  let rows = $state(0);

  /* Worst first, so what the tile cannot fit is only ever what is fine — and
     the last lamp that does fit counts the rest rather than half-showing one. */
  const RANK = { danger: 0, warn: 1, ok: 2, muted: 3 };
  const sorted = $derived([...cells].sort((a, b) => RANK[a.tone] - RANK[b.tone]));
  const room = $derived(Math.max(1, rows) * COLS);
  const shown = $derived(sorted.length > room ? sorted.slice(0, room - 1) : sorted);
  const rest = $derived(sorted.slice(shown.length));
</script>

<ul
  class="cells"
  style="--row: {ROW_REM}rem; --gap: {GAP_REM}rem; --cols: {COLS}"
  use:fitRows={{ row: ROW_REM, gap: GAP_REM, onfit: (n) => (rows = n) }}
>
  {#each shown as c (c.key)}
    <li class={c.tone} title={c.title ? `${c.label}: ${c.title}` : c.label}>
      <span class="lbl">{c.label}</span>
    </li>
  {/each}
  {#if rest.length}
    <li class="more" title={rest.map((c) => c.label).join(", ")}>
      <span class="lbl">+{rest.length} more</span>
    </li>
  {/if}
</ul>

<style>
  .cells {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-auto-rows: var(--row);
    align-content: start;
    gap: var(--gap);
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  /* A board of lamps: the tint is the state, the edge is the lamp. */
  li {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 var(--pad-2);
    border-left: 3px solid var(--tone-color);
    border-radius: 0 var(--radius) var(--radius) 0;
    background: color-mix(in srgb, var(--tone-color) 13%, transparent);
    font-size: var(--fs-xs);
    color: var(--text);
    cursor: default;
  }
  .lbl {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .muted,
  .more {
    --tone-color: var(--muted);
    color: var(--muted);
  }
  .more {
    background: none;
  }
</style>
