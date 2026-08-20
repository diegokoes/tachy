<script lang="ts">
  import type { Snippet } from "svelte";
  import { G } from "./glyphs";

  let {
    tone = "default",
    selected = false,
    title,
    onclick,
    onremove,
    children,
  }: {
    tone?: "default" | "accent" | "warn" | "muted";
    selected?: boolean;
    title?: string;
    onclick?: () => void;
    onremove?: () => void;
    children: Snippet;
  } = $props();
</script>

<span class="chip {tone}" class:selected class:clickable={Boolean(onclick)}>
  {#if onclick}
    <button class="hit" type="button" {title} {onclick}
      >{@render children()}</button
    >
  {:else}
    <span class="hit" {title}>{@render children()}</span>
  {/if}
  {#if onremove}
    <button class="x" type="button" aria-label="remove" onclick={onremove}
      >{G.del}</button
    >
  {/if}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    font-size: var(--fs-xs);
    line-height: 1.5;
    background: var(--accent-dim);
    border: 1px solid transparent;
    border-radius: var(--radius-chip);
    padding: 0 var(--pad-2);
    max-width: 100%;
    color: var(--text);
  }
  .chip.accent {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.muted {
    border-color: var(--border);
    color: var(--muted);
    background: none;
  }
  .chip.warn {
    border-color: var(--warn);
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }
  .chip.selected {
    border-color: var(--accent);
  }
  .chip.clickable:hover {
    border-color: var(--accent);
  }

  .hit {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.hit {
    cursor: pointer;
  }

  .x {
    font: inherit;
    font-size: 0.9em;
    line-height: 1;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 0 0 var(--pad-2);
  }
  .x:hover {
    color: var(--danger);
  }
</style>
