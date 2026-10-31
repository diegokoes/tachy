<script lang="ts">
  import SearchBox from "./SearchBox.svelte";

  let {
    value = $bindable(),
    shown,
    total,
    label = "search",
  }: {
    value: string;
    shown: number;
    total: number;
    label?: string;
  } = $props();
</script>

<!--
@component
The answer to a table that has grown past a screenful. Not pagination: these
lists are read by looking for one row, not by leafing through.
-->
<div class="bar">
  <SearchBox bind:value aria-label={label} />
  {#if total}
    <span class="count">{shown === total ? total : `${shown} of ${total}`}</span
    >
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--gap);
    margin-bottom: var(--pad-3);
  }
  .bar :global(.searchbox) {
    flex: 0 1 24rem;
    min-width: 12rem;
  }
  .count {
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
</style>
