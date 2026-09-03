<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { float } from "./float";

  let {
    label = "info",
    children,
  }: { label?: string; children: Snippet } = $props();

  let btn = $state<HTMLElement>();
  let hovered = $state(false);
  let focused = $state(false);
  let pinned = $state(false);
  const open = $derived(hovered || focused || pinned);
</script>

<!-- The mark sits inside a <label> in Field, where a bare click would fall
     through and focus the labelled control. The click is its own action here:
     on touch there is no hover to open it with. -->
<span class="mark">
  <button
    class="btn"
    type="button"
    bind:this={btn}
    onpointerenter={() => (hovered = true)}
    onpointerleave={() => (hovered = false)}
    aria-label={label}
    aria-expanded={open}
    onclick={(e) => {
      e.preventDefault();
      pinned = !pinned;
    }}
    onfocus={() => (focused = true)}
    onblur={() => {
      focused = false;
      pinned = false;
    }}
    onkeydown={(e) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        e.stopPropagation();
        pinned = false;
        focused = false;
      }
    }}
  >
    <Icon name="info" size="1em" weight={7} />
  </button>

  {#if open}
    <span
      class="tip"
      role="tooltip"
      use:float={{ anchor: btn, placement: "above-end", gap: 6 }}
      >{@render children()}</span
    >
  {/if}
</span>

<style>
  .mark {
    position: relative;
    display: inline-flex;
    flex: none;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5em;
    height: 1.5em;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--text);
    cursor: help;
  }
  .btn :global(svg) {
    transition: stroke-width 0.12s ease;
  }
  .mark:hover .btn :global(svg),
  .btn:focus-visible :global(svg) {
    stroke-width: var(--sw-hover, 9);
  }
  .btn:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }

  /* Placed by the float action, in viewport coordinates. As an absolutely
     positioned child it was cropped by whatever scrolling body it opened in,
     which is why hovering a mark near the bottom of a dialog showed half a
     box. The width is in ch so the measure stays readable at any font scale;
     the action keeps it inside the screen. */
  .tip {
    z-index: calc(var(--z-overlay) + 1);
    width: max-content;
    max-width: min(38ch, calc(100vw - 2rem));
    overflow-y: auto;
    padding: var(--pad-2) var(--pad-3);
    border: var(--panel-line);
    border-radius: var(--radius);
    background: var(--panel-solid);
    box-shadow: 0 2px 8px var(--drop);
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--text);
    text-align: left;
    white-space: normal;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .btn :global(svg) {
      transition: none;
    }
  }
</style>
