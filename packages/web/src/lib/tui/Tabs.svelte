<script lang="ts">
  import { pushScope } from "../keys.svelte";
  import { subnavKey } from "../keys/bindings.svelte";
  import { vimState } from "../vim.svelte";
  import { jellyPress } from "../motion";

  type Item = { key: string; label: string };

  let {
    items,
    active,
    onpick,
    hotkeys = "none",
  }: {
    items: Item[];
    active: string;
    onpick: (key: string) => void;
    /** "shift" claims ⇧1..⇧9 here; the plain digits belong to the tab bar. */
    hotkeys?: "none" | "shift";
  } = $props();

  function step(delta: number) {
    const i = items.findIndex((it) => it.key === active);
    const next = items[Math.min(items.length - 1, Math.max(0, i + delta))];
    if (next && next.key !== active) onpick(next.key);
  }

  // hidden: there is no longer a digit rendered to repeat, and Settings ›
  // keybinds is where these are listed now.
  $effect(() => {
    if (hotkeys !== "shift") return;
    const pick = onpick;
    return pushScope([
      ...items.slice(0, 9).map((it, i) => ({
        key: subnavKey(i),
        label: it.label,
        hidden: true,
        run: () => pick(it.key),
      })),
      ...(vimState.enabled
        ? [
            { key: "shift+h", label: "", hidden: true, run: () => step(-1) },
            { key: "shift+l", label: "", hidden: true, run: () => step(1) },
          ]
        : []),
    ]);
  });
</script>

<nav class="tabs">
  {#each items as it}
    {@const on = it.key === active}
    <button
      class="tab"
      class:on
      aria-current={on ? "page" : undefined}
      onclick={() => onpick(it.key)}
      use:jellyPress
    >
      <span class="lbl"
        ><span class="br" aria-hidden="true">[</span>{it.label}<span
          class="br"
          aria-hidden="true">]</span
        ></span
      >
    </button>
  {/each}

  <span class="rule" aria-hidden="true"></span>
</nav>

<style>
  /* btop's options-menu bar: the active tab is bracketed and a rule runs out to
     fill the remaining width. The brackets are always laid out and only toggled
     with visibility, so a tab keeps the same width whether or not it is the
     active one — the row never reflows when you switch section.

     The accent-colored hotkey digits that used to ride here are gone. The keys
     still work; Settings › keybinds is what advertises them. */
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
    border-radius: var(--radius-control);
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
</style>
