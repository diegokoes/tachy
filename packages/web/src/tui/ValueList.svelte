<script lang="ts">
  import type { Snippet } from "svelte";
  import Chip from "./Chip.svelte";
  import Icon from "./Icon.svelte";
  import { tip } from "./tip.svelte";

  let {
    values,
    label,
    variant = "chips",
    mono = false,
    item,
    accepts,
    refusal,
    onchange,
  }: {
    values: string[];
    /** What the list holds, for the add field's accessible name. */
    label: string;
    /** Chips for short labels; lines for values long enough to wrap. */
    variant?: "chips" | "lines";
    /** Lines in the code face, for identifiers such as error codes. */
    mono?: boolean;
    /** Draws one value in place of its text, such as a link. */
    item?: Snippet<[string]>;
    /** Whether typed text may be added; said `refusal` when not. */
    accepts?: (value: string) => boolean;
    refusal?: string;
    /** Makes the list editable: a value can be removed, and one added. */
    onchange?: (values: string[]) => void;
  } = $props();

  let typed = $state("");
  let refused = $state(false);

  const remove = (index: number) =>
    onchange?.(values.filter((_, at) => at !== index));

  function addTyped() {
    const value = typed.trim();
    if (!value) return;
    refused = accepts ? !accepts(value) : false;
    if (refused) return;
    typed = "";
    if (!values.includes(value)) onchange?.([...values, value]);
  }
</script>

<!--
@component
A list of values. Editable, a value goes on ×, and the field at the end adds
what was typed, whole, on enter or when it loses focus.
-->
{#snippet addField()}
  {#if onchange}
    <span class="add" class:block={variant === "lines"}>
      <span aria-hidden="true">+</span>
      <input
        aria-label="add to {label}"
        aria-invalid={refused}
        bind:value={typed}
        oninput={() => (refused = false)}
        onblur={addTyped}
        onkeydown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          addTyped();
        }}
      />
    </span>
    {#if refused && refusal}<p class="refused">{refusal}</p>{/if}
  {/if}
{/snippet}

{#snippet text(value: string)}{value}{/snippet}

{#if variant === "chips"}
  <div class="chips">
    {#each values as value, i}
      <Chip onremove={onchange ? () => remove(i) : undefined}
        >{@render (item ?? text)(value)}</Chip
      >
    {/each}
    {@render addField()}
  </div>
{:else}
  <ul class="lines" class:mono>
    {#each values as value, i}
      <li>
        <span class="value">{@render (item ?? text)(value)}</span>
        {#if onchange}
          <button
            class="x"
            type="button"
            aria-label="remove"
            use:tip={"remove"}
            onclick={() => remove(i)}
            ><Icon name="close" size="0.9em" weight={7} /></button
          >
        {/if}
      </li>
    {/each}
  </ul>
  {@render addField()}
{/if}

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-1);
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-sm);
    line-height: 1.45;
  }
  .lines.mono {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .lines li {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
  }
  .value {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .x {
    flex: none;
    padding: 0;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .x:hover,
  .x:focus-visible {
    color: var(--text);
  }
  .add {
    display: inline-flex;
    align-items: baseline;
    gap: var(--pad-1);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .add.block {
    display: flex;
    margin-top: var(--pad-2);
  }
  /* A line to type on, not a framed control. */
  .add input {
    width: 14ch;
    min-height: 0;
    padding: 0;
    font: inherit;
    color: var(--text);
    background: none;
    border: none;
    border-bottom: 1px dotted var(--border);
    border-radius: 0;
  }
  .add.block input {
    flex: 1;
    width: auto;
  }
  .add input:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
  .add input[aria-invalid="true"] {
    border-bottom-color: var(--danger);
  }
  .refused {
    margin: var(--pad-1) 0 0;
    font-size: var(--fs-xs);
    color: var(--danger);
  }
</style>
