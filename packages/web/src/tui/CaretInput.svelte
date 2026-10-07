<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import Caret, { caretSide, type CaretSide } from "./Caret.svelte";
  import type { IconName } from "./icons";

  /**
   * A bare text input that draws its own caret and keeps it at the end of the
   * text while unfocused, so a filter reads as writeable before it is clicked.
   * The box around it belongs to whoever mounts it. With `icon` and `hint` it
   * stands in for a placeholder: empty and unfocused it shows the mark and the
   * word, and the caret morphs out of the mark on focus.
   */
  let {
    value = $bindable(""),
    el = $bindable(),
    icon,
    hint,
    ...rest
  }: Omit<HTMLInputAttributes, "value" | "placeholder" | "type"> & {
    value?: string;
    el?: HTMLInputElement;
    icon?: IconName;
    hint?: string;
  } = $props();

  let at = $state(0);
  let scroll = $state(0);
  let ranged = $state(false);
  let beat = $state(0);
  let side = $state<CaretSide>("bare");
  let focused = $state(false);

  const idle = $derived(!!icon && !focused && value === "");
  const dim = $derived(!!icon && !focused && value !== "");

  function sync() {
    if (!el) return;
    focused = document.activeElement === el;
    const next = focused ? (el.selectionStart ?? value.length) : value.length;
    ranged = focused && el.selectionEnd !== el.selectionStart;
    scroll = focused ? el.scrollLeft : 0;
    side = caretSide(value, next);
    if (next !== at) beat++;
    at = next;
  }

  $effect(() => {
    void value;
    sync();
  });

  // Not every engine fires selectionchange on the input itself, and none fires
  // anything when an arrow key only scrolls the text.
  $effect(() => {
    if (!el) return;
    const node = el;
    const later = () => requestAnimationFrame(sync);
    const events = ["focus", "blur", "keydown", "pointerup", "select"];
    for (const type of events) node.addEventListener(type, later);
    document.addEventListener("selectionchange", sync);
    return () => {
      for (const type of events) node.removeEventListener(type, later);
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
          class:dim><Caret {beat} {side} {icon} {idle} /></span
        >{/if}{#if hint && value === ""}<span class="hint" class:idle
          >{hint}</span
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
    /* Wider than the input on both sides: at either end of the text the caret
       stands just outside it, and would be clipped away. */
    position: absolute;
    inset: 0 -0.4em;
    padding: 0 0.4em;
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
  .ci:focus-within .mark {
    opacity: 1;
  }
  .mark.dim {
    opacity: 0;
  }
  .mark {
    transition: opacity 0.16s ease;
  }
  .hint {
    /* Past the mark, which has no width of its own to push it. */
    margin-left: 1.3em;
    color: var(--muted);
    opacity: 0;
    transition: opacity 0.16s ease;
  }
  .hint.idle {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .mark,
    .hint {
      transition: none;
    }
  }
</style>
