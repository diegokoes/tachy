<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="rows">{@render children()}</div>

<style>
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
    container-type: inline-size;
  }
</style>
