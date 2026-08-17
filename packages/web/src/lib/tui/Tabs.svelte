<script lang="ts">
  import type { Snippet } from "svelte";
  import { superscript } from "../nav.svelte";
  import { pushScope } from "../keys.svelte";

  type Item = { key: string; label: string };

  let {
    items,
    active,
    onpick,
    right,
    numbered = true,
    hotkeys = "none",
  }: {
    items: Item[];
    active: string;
    onpick: (key: string) => void;
    right?: Snippet;
    numbered?: boolean;
    /** "shift" claims ⇧1..⇧9 here; the plain digits belong to the tab bar. */
    hotkeys?: "none" | "shift";
  } = $props();

  // hidden: the tabs render their own hotkey marker.
  $effect(() => {
    if (hotkeys !== "shift") return;
    const pick = onpick;
    return pushScope(
      items.slice(0, 9).map((it, i) => ({
        key: `shift+${i + 1}`,
        label: it.label,
        hidden: true,
        run: () => pick(it.key),
      })),
    );
  });
</script>

<nav class="tabs">
  {#each items as it, i}
    {@const on = it.key === active}
    <button
      class="tab"
      class:on
      aria-current={on ? "page" : undefined}
      onclick={() => onpick(it.key)}
    >
      {#if numbered && i < 9}
        <span class="num" aria-hidden="true">{superscript(i + 1)}</span>
      {/if}
      <span class="lbl"
        ><span class="br" aria-hidden="true">[</span>{it.label}<span
          class="br"
          aria-hidden="true">]</span
        ></span
      >
    </button>
  {/each}

  <span class="rule" aria-hidden="true"></span>

  {#if right}<span class="right">{@render right()}</span>{/if}
</nav>

<style>
  /* btop's options-menu bar: the active tab is bracketed, the hotkey digit
     rides in the accent, and a rule runs out to fill the remaining width.
     Brackets and digit are always laid out and only toggled with visibility,
     so a tab keeps the same width whether or not it is the active one — the
     row never reflows when you switch section. */
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
    min-width: 0;
  }

  .tab {
    display: inline-flex;
    align-items: baseline;
    gap: 0.1em;
    font: inherit;
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--muted);
    padding: var(--pad-1) var(--pad-2);
    white-space: nowrap;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.on {
    color: var(--accent);
  }
  .tab:focus-visible {
    outline: none;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .num {
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  .tab.on .num {
    visibility: hidden;
  }

  .br {
    visibility: hidden;
  }
  .tab.on .br {
    visibility: visible;
  }

  .rule {
    flex: 1;
    min-width: 1ch;
    height: 0;
    align-self: center;
    border-top: var(--panel-line);
    margin: 0 var(--pad-2);
  }

  .right {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--gap);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
