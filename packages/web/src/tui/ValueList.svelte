<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import Chip from "./Chip.svelte";
  import Icon from "./Icon.svelte";
  import { tip } from "./tip.svelte";

  let {
    values,
    label,
    variant = "chips",
    mono = false,
    adding = false,
    item,
    accepts,
    refusal,
    onchange,
    ondone,
  }: {
    values: string[];
    /** What the list holds, for the new value's accessible name. */
    label: string;
    /** Chips for short labels; lines for values long enough to wrap. */
    variant?: "chips" | "lines";
    /** Lines in the code face, for identifiers such as error codes. */
    mono?: boolean;
    /** Shows an empty value at the end, focused, to type a new one into. */
    adding?: boolean;
    /** Draws one value in place of its text, such as a link. */
    item?: Snippet<[string]>;
    /** Whether typed text may be added; said `refusal` when not. */
    accepts?: (value: string) => boolean;
    refusal?: string;
    /** Makes the list editable: a value can be removed, and one added. */
    onchange?: (values: string[]) => void;
    /** The new value was left: esc, or focus moved elsewhere. */
    ondone?: () => void;
  } = $props();

  let typed = $state("");
  let refused = $state(false);
  let field = $state<HTMLInputElement>();

  const remove = (index: number) =>
    onchange?.(values.filter((_, at) => at !== index));

  /** Adds what was typed; false when it was refused and stays to be fixed. */
  function addTyped(): boolean {
    const value = typed.trim();
    if (!value) return true;
    refused = accepts ? !accepts(value) : false;
    if (refused) return false;
    typed = "";
    if (!values.includes(value)) onchange?.([...values, value]);
    return true;
  }

  function finish() {
    if (!addTyped()) return;
    refused = false;
    ondone?.();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTyped();
    } else if (e.key === "Escape") {
      e.preventDefault();
      typed = "";
      refused = false;
      ondone?.();
    }
  }

  $effect(() => {
    if (adding) void tick().then(() => field?.focus());
  });
</script>

<!--
@component
A list of values. Editable, a value goes on ×; while `adding`, a new one is
typed at the end and goes in on enter, which leaves the next one ready.
-->
{#snippet newValue()}
  <input
    class="new"
    class:refused
    aria-label="new {label}"
    bind:this={field}
    bind:value={typed}
    oninput={() => (refused = false)}
    onkeydown={onKeydown}
    onblur={finish}
  />
{/snippet}

{#snippet text(value: string)}{value}{/snippet}

{#if variant === "chips"}
  <div class="chips">
    {#each values as value, i}
      <Chip onremove={onchange ? () => remove(i) : undefined}
        >{@render (item ?? text)(value)}</Chip
      >
    {/each}
    {#if adding && onchange}{@render newValue()}{/if}
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
    {#if adding && onchange}<li>{@render newValue()}</li>{/if}
  </ul>
{/if}
{#if refused && refusal}<p class="refusal">{refusal}</p>{/if}

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
  /* As wide as a square button, so × sits under the + in the heading. */
  .x {
    flex: none;
    display: inline-flex;
    justify-content: center;
    width: var(--row-h);
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
  .new {
    flex: 1;
    min-width: 10ch;
    min-height: 0;
    padding: 0;
    font: inherit;
    line-height: inherit;
    color: var(--text);
    background: none;
    border: 0;
    border-bottom: 1px solid var(--accent);
    border-radius: 0;
    outline: none;
  }
  .chips .new {
    flex: 0 1 14ch;
    font-size: var(--fs-xs);
  }
  /* Its accent line is the focus mark; the app's inset ring would box it. */
  .new:focus-visible {
    box-shadow: none;
  }
  .new.refused {
    border-bottom-color: var(--danger);
  }
  .refusal {
    margin: var(--pad-1) 0 0;
    font-size: var(--fs-xs);
    color: var(--danger);
  }
</style>
