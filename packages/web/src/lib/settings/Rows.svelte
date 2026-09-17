<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="rows">{@render children()}</div>

<style>
  .rows {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
</style>
