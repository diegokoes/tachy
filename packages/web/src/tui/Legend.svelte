<script lang="ts">
  import { toneVar } from "./scale";
  import type { LegendItem } from "./marks";

  let {
    items,
    hidden = [],
    ontoggle,
  }: {
    items: LegendItem[];
    /** Keys switched off; their swatch is drawn hollow. */
    hidden?: string[];
    /** Given, each entry is a button that switches its series. */
    ontoggle?: (key: string) => void;
  } = $props();
</script>

{#if items.length}
  <div class="legend">
    {#each items as item (item.key)}
      {#if ontoggle}
        <button
          type="button"
          class="key pick"
          class:off={hidden.includes(item.key)}
          aria-pressed={!hidden.includes(item.key)}
          style="--tone-color: {toneVar(item.tone)}"
          onclick={() => ontoggle(item.key)}>{item.label}</button
        >
      {:else}
        <span class="key" style="--tone-color: {toneVar(item.tone)}"
          >{item.label}</span
        >
      {/if}
    {/each}
  </div>
{/if}

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 var(--pad-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .key::before {
    content: "";
    box-sizing: border-box;
    display: inline-block;
    width: 0.75em;
    height: 1em;
    margin-right: var(--pad-1);
    vertical-align: middle;
    border-radius: 2px;
    background: var(--tone-color);
  }
  .pick {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .pick:hover,
  .pick:focus-visible {
    color: var(--text);
  }
  .off {
    opacity: 0.6;
  }
  .off::before {
    background: none;
    border: 1px solid var(--tone-color);
  }
</style>
