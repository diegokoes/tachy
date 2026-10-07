<script lang="ts" module>
  import type { Tone } from "./overview";

  export type Fact = {
    key: string;
    label: string;
    value: string;
    /** The reading behind the value, in small print. */
    detail?: string;
    tone?: Tone;
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { fitRows, fitted } from "../tui/fit";

  // A line of readout, not a control: the same rhythm as Bars' rows, so a facts
  // tile and a bars tile side by side line up.
  const ROW_REM = 1.3;
  const GAP_REM = 0.15;

  let {
    items,
    extra,
  }: {
    items: Fact[];
    /** Drawn at the right of a row, keyed by the fact: a toggle, a button. */
    extra?: Snippet<[Fact]>;
  } = $props();

  let room = $state(0);
  // As many readings as the tile holds, the rest folded into one line: the tile
  // sizes with the window, and a clipped row reads as a missing one.
  const cut = $derived(fitted(items, room));
</script>

<!--
@component
A short list of readings, label left and value right, for the tiles that report
states rather than quantities. A chart of "configured / not configured" is a
chart of one bit.
-->
<dl
  class="facts"
  style="--row: {ROW_REM}rem; --gap: {GAP_REM}rem"
  use:fitRows={{ row: ROW_REM, gap: GAP_REM, onfit: (n) => (room = n) }}
>
  {#each cut.shown as fact (fact.key)}
    <div class="row">
      <dt>{fact.label}</dt>
      <dd class={fact.tone ?? ""}>
        <span class="v">{fact.value}</span>
        {#if fact.detail}<span class="d">{fact.detail}</span>{/if}
      </dd>
      {#if extra}<span class="x">{@render extra(fact)}</span>{/if}
    </div>
  {/each}
  {#if cut.rest.length}
    <div class="row more">
      <dt>+{cut.rest.length} more</dt>
    </div>
  {/if}
</dl>

<style>
  .facts {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    height: 100%;
    margin: 0;
    min-height: 0;
    overflow: hidden;
    font-size: var(--fs-xs);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(6rem, 40%) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--pad-2);
    height: var(--row);
    flex: none;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }
  dt {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    margin: 0;
    min-width: 0;
    color: var(--text);
  }
  .v {
    font-family: var(--font-mono);
    white-space: nowrap;
  }
  .d {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ok .v {
    color: var(--ok);
  }
  .warn .v {
    color: var(--warn);
  }
  .danger .v {
    color: var(--danger);
  }
  .muted .v {
    color: var(--muted);
  }
  .more {
    border-bottom: none;
  }
  .x {
    display: inline-flex;
    align-items: center;
  }
</style>
