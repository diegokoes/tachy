<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    counts,
    health,
    detail,
    attention,
  }: {
    /** The headline figures, first because they are what a glance is for. */
    counts?: Snippet;
    /** Is it working — coverage rings, config checks. */
    health?: Snippet;
    /** The shape of what is in there, once you know it is working. */
    detail?: Snippet;
    /** What to go and fix, last because it is the thing you act on. */
    attention?: Snippet;
  } = $props();
</script>

<!-- An overview is one section, so it is drawn as one thing: four bands in a
     fixed order, separated by air. No frames around the parts and no rubric
     over each band — the figures and chart titles already say what they are,
     and a label reading "COUNTS" over five counts is ink that carries nothing. -->
<div class="overview">
  {#if counts}<div class="band">{@render counts()}</div>{/if}
  {#if health}<div class="band">{@render health()}</div>{/if}
  {#if detail}<div class="band">{@render detail()}</div>{/if}
  {#if attention}<div class="band">{@render attention()}</div>{/if}
</div>

<style>
  .overview {
    display: flex;
    flex-direction: column;
    /* Twice the gap anything inside a band uses, which is the whole of what
       separates them now. */
    gap: calc(var(--pad-4) * 2);
    min-width: 0;
  }
  .band {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    min-width: 0;
  }
</style>
