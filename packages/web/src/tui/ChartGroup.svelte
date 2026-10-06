<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    createChartGroup,
    setChartGroup,
    type ChartGroup,
  } from "./chartGroup.svelte";

  let { children }: { children: Snippet<[ChartGroup]> } = $props();

  const group = createChartGroup();
  setChartGroup(group);
</script>

{@render children(group)}
