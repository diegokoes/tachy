<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    min = "14rem",
    children,
  }: {
    /** Narrowest a single-span card may get before the row rewraps. */
    min?: string;
    children: Snippet;
  } = $props();
</script>

<!-- The grid Cards span across. auto-fill rather than auto-fit: a card that
     asked for two columns has to have two columns to take, and auto-fit
     collapses the empty tracks that make that possible. -->
<div class="deck" style="--min: {min}">
  {@render children()}
</div>

<style>
  .deck {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--min), 1fr));
    gap: var(--pad-3);
    align-items: start;
  }
</style>
