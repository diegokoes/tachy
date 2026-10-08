<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<!--
@component
Two tiles in one cell of the grid: the one that sizes to its content takes what
it needs, the other the rest.
-->
<div class="stack">{@render children()}</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: calc(var(--pad-4) * 2);
    min-width: 0;
    min-height: 0;
  }
  .stack > :global(.tile:not(.content)) {
    flex: 1 1 0;
  }
</style>
