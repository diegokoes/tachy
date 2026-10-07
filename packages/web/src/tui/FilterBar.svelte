<script lang="ts">
  import CaretInput from "./CaretInput.svelte";

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

  let el = $state<HTMLInputElement>();
</script>

<!--
@component
The answer to a table that has grown past a screenful. Not pagination: these
lists are read by looking for one row, not by leafing through.
-->
<div class="bar">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    class="box"
    onpointerdown={(e) => {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      el?.focus();
    }}
  >
    <CaretInput
      bind:el
      bind:value
      icon="search"
      hint="Search"
      aria-label={label}
    />
  </span>
  <span class="count">{shown === total ? total : `${shown} of ${total}`}</span>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--gap);
    margin-bottom: var(--pad-3);
  }
  .box {
    flex: 0 1 24rem;
    min-width: 12rem;
    min-height: var(--control-h);
    display: flex;
    align-items: stretch;
    padding: 0 var(--pad-3);
    border: 1px solid var(--border-bare);
    border-radius: var(--radius-control);
    background: var(--panel-bg);
    cursor: text;
  }
  .box:has(:global(input:focus-visible)) {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .count {
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
</style>
