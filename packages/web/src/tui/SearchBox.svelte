<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";
  import CaretInput from "./CaretInput.svelte";

  let {
    value = $bindable(""),
    el = $bindable(),
    children,
    ...rest
  }: Omit<HTMLInputAttributes, "value" | "placeholder" | "type"> & {
    value?: string;
    el?: HTMLInputElement;
    /** Controls kept inside the box after the text, such as a reset. */
    children?: Snippet;
  } = $props();
</script>

<!--
@component
A search field: the box, and a caret that rests on a search mark while the
field is empty. No word stands in the field; its aria-label names it. The
parent sizes it through `:global(.searchbox)`.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="searchbox"
  class:fitted={!!children}
  onpointerdown={(e) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    el?.focus();
  }}
>
  <CaretInput bind:el bind:value icon="search" {...rest} />
  {@render children?.()}
</span>

<style>
  .searchbox {
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--control-h);
    display: flex;
    align-items: stretch;
    gap: var(--pad-1);
    padding: 0 var(--pad-3);
    border: 1px solid var(--border-bare);
    border-radius: var(--radius-control);
    background: var(--panel-bg);
    cursor: text;
  }
  /* The controls at its end bring their own padding. */
  .fitted {
    padding-right: 0;
  }
  .searchbox:has(:global(input:focus-visible)) {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
</style>
