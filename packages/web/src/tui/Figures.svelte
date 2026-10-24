<script lang="ts">
  import { keepUnits } from "./figures";
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
      <span class="l">{keepUnits(item.label)}</span>
      {#if item.note}<span class="n">{item.note}</span>{/if}
    </div>
  {/each}
</div>

<style>
  /* Sized by its tile, not its figures, so a short tile can drop the notes
     instead of pushing the figures up over its header. */
  .figures {
    container-type: size;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: safe center;
    gap: var(--pad-3) var(--pad-4);
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
  @container (max-height: 11rem) {
    .n {
      display: none;
    }
  }
</style>
