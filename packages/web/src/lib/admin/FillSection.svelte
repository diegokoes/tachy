<script lang="ts">
  import type { Component } from "svelte";

  let { view: View }: { view: Component } = $props();
</script>

<!-- App drops the window's padding around `.bleed`, so the view runs to its
     edges; the view carries no heading of its own. -->
<div class="fill bleed"><View /></div>

<style>
  .fill {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
