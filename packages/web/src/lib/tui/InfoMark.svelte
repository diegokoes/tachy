<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    label = "info",
    children,
  }: { label?: string; children: Snippet } = $props();
</script>

<!-- The mark sits inside a <label> in Field, where a bare click would fall
     through and focus the labelled control. It has no action of its own. -->
<span class="mark">
  <button
    class="btn"
    type="button"
    aria-label={label}
    onclick={(e) => e.preventDefault()}
  >
    <Icon name="info" size="1em" weight={7} />
  </button>
  <span class="tip" role="tooltip">{@render children()}</span>
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
    stroke-width: 9;
  }
  .btn:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }

  .tip {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--pad-2));
    z-index: var(--z-dropdown);
    width: max-content;
    max-width: 34ch;
    padding: var(--pad-2) var(--pad-3);
    border: var(--panel-line);
    border-radius: var(--radius);
    background: var(--panel-solid);
    box-shadow: 0 2px 8px var(--drop);
    font-size: var(--fs-xs);
    color: var(--text);
    text-align: left;
    white-space: normal;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }
  .mark:hover .tip,
  .btn:focus-visible + .tip {
    opacity: 1;
    visibility: visible;
  }

  @media (prefers-reduced-motion: reduce) {
    .btn :global(svg) {
      transition: none;
    }
  }
</style>
