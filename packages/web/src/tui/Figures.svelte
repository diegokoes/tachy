<script lang="ts">
  import { toneVar } from "./scale";
  import type { Tone } from "./tone";

  export type FigureItem = {
    key: string;
    /** The figure itself: a percentage, a count. */
    value: string;
    label: string;
    /** Under the label, in figures: "815 / 853". */
    note?: string;
    tone?: Tone;
  };

  let { items }: { items: FigureItem[] } = $props();
</script>

<!--
@component
Four numbers that are each a share of something need to be read, not measured
against one another: the figure, what it is, out of what.
-->
<div class="figures">
  {#each items as item (item.key)}
    <div class="one" style="--tone-color: {toneVar(item.tone ?? 'accent')}">
      <span class="v">{item.value}</span>
      <span class="l">{item.label}</span>
      {#if item.note}<span class="n">{item.note}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .figures {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: center;
    gap: var(--pad-5, var(--pad-4)) var(--pad-4);
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .one {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
    padding-left: var(--pad-3);
    border-left: 2px solid var(--tone-color);
  }
  .v {
    font-family: var(--font-mono);
    font-size: var(--fs-fig);
    line-height: 1.1;
    color: var(--tone-color);
  }
  .l {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--text);
  }
  .n {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
