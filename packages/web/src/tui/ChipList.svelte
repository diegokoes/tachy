<script lang="ts">
  import Chip from "./Chip.svelte";

  let {
    values,
    label,
    onchange,
  }: {
    values: string[];
    /** What the list holds, for the add field's accessible name. */
    label: string;
    /** Makes the list editable: a chip can be removed, and one added. */
    onchange?: (values: string[]) => void;
  } = $props();

  let typed = $state("");

  function addTyped() {
    const value = typed.trim();
    typed = "";
    if (!value || values.includes(value)) return;
    onchange?.([...values, value]);
  }
</script>

<!--
@component
Short values as chips. Editable, a chip loses its value on ×, and the field at
the end adds what was typed, whole, on enter or when it loses focus.
-->
<div class="chips">
  {#each values as value, i}
    <Chip
      onremove={onchange
        ? () => onchange(values.filter((_, at) => at !== i))
        : undefined}>{value}</Chip
    >
  {/each}
  {#if onchange}
    <span class="add">
      <span class="plus" aria-hidden="true">+</span>
      <input
        aria-label="add to {label}"
        bind:value={typed}
        onblur={addTyped}
        onkeydown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          addTyped();
        }}
      />
    </span>
  {/if}
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-1);
  }
  .add {
    display: inline-flex;
    align-items: baseline;
    gap: var(--pad-1);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .add input {
    width: 14ch;
    padding: 0;
    font: inherit;
    color: var(--text);
    background: none;
    border: none;
    border-bottom: 1px dotted var(--border);
  }
  .add input:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
</style>
