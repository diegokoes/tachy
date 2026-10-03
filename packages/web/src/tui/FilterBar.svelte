<script lang="ts">
  let {
    value = $bindable(),
    shown,
    total,
    placeholder = "filter…",
    label = "filter",
  }: {
    value: string;
    shown: number;
    total: number;
    placeholder?: string;
    label?: string;
  } = $props();
</script>

<!-- The answer to a table that has grown past a screenful. Not pagination:
     these lists are read by looking for one row, not by leafing through. -->
<div class="bar">
  <input type="text" {placeholder} aria-label={label} bind:value />
  <span class="count">{shown === total ? total : `${shown} of ${total}`}</span>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--gap);
    margin-bottom: var(--pad-3);
  }
  .bar input {
    min-width: 16rem;
    max-width: 24rem;
  }
  .count {
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
</style>
