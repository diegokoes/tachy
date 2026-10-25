<script lang="ts">
  import { tick } from "svelte";
  import Button from "./Button.svelte";
  import Icon from "./Icon.svelte";
  import { float } from "./float";
  import type { IconName } from "./icons";
  import type { MenuItem } from "./menu";

  let {
    label,
    icon,
    tone,
    items,
    empty = "",
    open = $bindable(false),
    onpick,
  }: {
    /** The trigger's word, and the list's accessible name. */
    label: string;
    icon?: IconName;
    tone?: "ok" | "accent";
    items: MenuItem[];
    /** Said in place of the rows while there are none. */
    empty?: string;
    open?: boolean;
    onpick: (key: string) => void;
  } = $props();

  let root = $state<HTMLElement>();
  let panel = $state<HTMLElement>();
  let cursor = $state(0);

  $effect(() => {
    if (!open) return;
    cursor = Math.max(
      0,
      items.findIndex((item) => item.current),
    );
    void tick().then(() => panel?.focus());
  });

  function close() {
    open = false;
    root?.querySelector("button")?.focus();
  }

  function pick(index: number) {
    const item = items[index];
    if (!item) return;
    open = false;
    onpick(item.key);
  }

  function onKeydown(e: KeyboardEvent) {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step && items.length) {
      e.preventDefault();
      cursor = (cursor + step + items.length) % items.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(cursor);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function outside(e: PointerEvent) {
    if (!open) return;
    const target = e.target as Node;
    if (!root?.contains(target) && !panel?.contains(target)) open = false;
  }
</script>

<svelte:window onpointerdown={outside} />

<!--
@component
A short list of places or actions behind one button in a corner, drawn like a
select's list: an accent edge, the cursor row in inverse, › on the row the
reader is on. ↑ ↓ move, ⏎ picks, esc and a click outside close it.
-->
<span class="menu" bind:this={root}>
  <Button
    variant="ghost"
    size="sm"
    {icon}
    {tone}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
    >{label}<span class="arrow" aria-hidden="true">▾</span></Button
  >
  {#if open}
    <div
      class="panel"
      role="menu"
      aria-label={label}
      tabindex="-1"
      bind:this={panel}
      use:float={{ anchor: root, placement: "below-end", gap: 4 }}
      onkeydown={onKeydown}
    >
      {#each items as item, i (item.key)}
        <div
          class="opt"
          class:cursor={i === cursor}
          class:current={item.current}
          role="menuitem"
          tabindex="-1"
          onpointerenter={() => (cursor = i)}
          onpointerdown={(e) => {
            e.preventDefault();
            pick(i);
          }}
        >
          <span class="mark" aria-hidden="true">{item.current ? "›" : " "}</span
          >
          {#if item.icon}<span class="glyph" style:color={item.color}
              ><Icon name={item.icon} size="1em" /></span
            >{/if}
          <span class="txt">{item.label}</span>
          {#if item.hint}<span class="hint">{item.hint}</span>{/if}
        </div>
      {:else}
        <span class="empty">{empty}</span>
      {/each}
    </div>
  {/if}
</span>

<style>
  .menu {
    display: inline-flex;
  }
  .arrow {
    margin-left: 0.4em;
    font-size: 0.8em;
    color: var(--accent);
  }

  /* The select's list, so the two read as one family. */
  .panel {
    z-index: calc(var(--z-overlay) + 1);
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 12rem;
    max-width: min(90vw, 22rem);
    overflow: hidden;
    --edge: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: var(--panel-bg);
    border: 1px solid var(--edge);
    border-radius: var(--radius-control);
    box-shadow: 0 4px 14px var(--drop);
  }
  .panel:focus-visible {
    outline: none;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-1) var(--pad-3);
    white-space: nowrap;
    cursor: pointer;
    color: var(--text);
  }
  .mark {
    flex: none;
    width: 0.6em;
    color: var(--accent);
  }
  .glyph {
    display: inline-flex;
    color: var(--muted);
  }
  .txt {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    margin-left: auto;
    padding-left: var(--pad-4);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .opt.current {
    color: var(--accent);
  }
  .opt.cursor {
    background: var(--accent-fill);
    color: var(--bg);
  }
  .opt.cursor .mark,
  .opt.cursor .hint,
  .opt.cursor .glyph {
    color: var(--bg);
  }
  .empty {
    padding: var(--pad-1) var(--pad-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
