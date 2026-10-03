<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import Caret from "./Caret.svelte";

  /**
   * A bare text input that draws its own caret, and keeps it at the end of
   * what was typed while it is not focused, so a filter reads as writeable
   * before it is clicked. The box around it belongs to whoever mounts it.
   */
  let {
    value = $bindable(""),
    el = $bindable(),
    ...rest
  }: Omit<HTMLInputAttributes, "value" | "placeholder" | "type"> & {
    value?: string;
    el?: HTMLInputElement;
  } = $props();

  let at = $state(0);
  let scroll = $state(0);
  let ranged = $state(false);
  let beat = $state(0);
  let leading = $state(true);

  function sync() {
    if (!el) return;
    const focused = document.activeElement === el;
    const next = focused ? (el.selectionStart ?? value.length) : value.length;
    ranged = focused && el.selectionEnd !== el.selectionStart;
    scroll = focused ? el.scrollLeft : 0;
    leading = !/\S/.test(value.charAt(next - 1));
    if (next !== at) beat++;
    at = next;
  }

  $effect(() => {
    void value;
    sync();
  });

  /* Not every engine fires selectionchange on the input itself, and none
     fires anything when an arrow key only scrolls the text. */
  $effect(() => {
    if (!el) return;
    const node = el;
    const later = () => requestAnimationFrame(sync);
    const events = ["focus", "blur", "keydown", "pointerup", "select"];
    for (const e of events) node.addEventListener(e, later);
    document.addEventListener("selectionchange", sync);
    return () => {
      for (const e of events) node.removeEventListener(e, later);
      document.removeEventListener("selectionchange", sync);
    };
  });
</script>

<span class="ci">
  <input
    type="text"
    autocomplete="off"
    data-caret="own"
    bind:this={el}
    bind:value
    {...rest}
  />
  <span class="over" aria-hidden="true">
    <span class="line" style:translate="{-scroll}px 0"
      ><span class="typed">{value.slice(0, at)}</span>{#if !ranged}<span
          class="mark"
          class:leading><Caret {beat} /></span
        >{/if}</span
    >
  </span>
</span>

<style>
  .ci {
    position: relative;
    flex: 1 1 6ch;
    min-width: 6ch;
    display: flex;
    align-items: center;
  }
  input {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    caret-color: transparent;
  }
  input:focus,
  input:focus-visible {
    outline: none;
    box-shadow: none;
  }

  .over {
    /* Wider than the input on the left: at the start of the text the caret
       stands just outside it, and would be clipped away. */
    position: absolute;
    inset: 0 0 0 -0.4em;
    padding-left: 0.4em;
    display: flex;
    align-items: center;
    overflow: hidden;
    pointer-events: none;
  }
  .line {
    display: flex;
    align-items: center;
    white-space: pre;
  }
  .typed {
    visibility: hidden;
  }
  /* No width of its own, so the caret sits between two letters instead of
     pushing them apart. */
  .mark {
    display: inline-flex;
    width: 0;
    margin-left: -0.115em;
    padding-right: 0.115em;
    color: var(--accent);
    opacity: 0.55;
  }
  .mark.leading {
    margin-left: -0.25em;
    padding-right: 0.25em;
  }
  .ci:focus-within .mark {
    opacity: 1;
  }
</style>
