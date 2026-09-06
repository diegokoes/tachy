<script lang="ts">
  import { navItems } from "../nav";
  import {
    keymap,
    navKey,
    subnavKey,
    setNavKey,
    setSubnavKey,
    resetKeys,
    conflicts,
    defaultNavKey,
    defaultSubnavKey,
  } from "../keys/bindings.svelte";
  import { normalize } from "../keys.svelte";
  import { vimState, setVim } from "../vim.svelte";
  import { Button, Checkbox, Panel, VimMark } from "../tui";

  const nav = $derived(navItems());
  /** The widest subnav in the app; admin and settings both run three deep. */
  const SUBNAV_SLOTS = 3;

  type Capture =
    | { kind: "nav"; item: string }
    | { kind: "subnav"; slot: number }
    | null;

  let capturing = $state<Capture>(null);
  let warning = $state("");

  function label(key: string): string {
    return key
      .replace(/^shift\+/, "⇧")
      .replace(/^ctrl\+/, "^")
      .replace(/ /g, " then ");
  }

  /* Captured through the dispatcher's own normalize(), so a key recorded here
     is byte-for-byte the string a keypress will later be matched against —
     anything else silently records bindings that can never fire. Modifier-only
     presses are ignored: you cannot bind Shift by itself. */
  function capture(e: KeyboardEvent) {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      capturing = null;
      warning = "";
      return;
    }
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;

    const key = normalize(e, e.ctrlKey);
    const hits = conflicts(key, nav, SUBNAV_SLOTS, capturing);
    if (hits.length) {
      warning = `${label(key)} is already ${hits.join(" and ")}.`;
      return;
    }
    if (capturing.kind === "nav") setNavKey(capturing.item, key);
    else setSubnavKey(capturing.slot, key);
    capturing = null;
    warning = "";
  }

  const arming = (c: Capture) => {
    capturing = c;
    warning = "";
  };

  const customized = $derived(
    Object.keys(keymap.nav).length + Object.keys(keymap.subnav).length > 0,
  );

  const REFERENCE: { key: string; what: string }[] = [
    { key: "ctrl+k", what: "focus search / composer" },
    { key: "⏎", what: "open the highlighted row" },
    { key: "esc", what: "dismiss a dialog or menu" },
    { key: "backspace", what: "back from a detail view" },
    { key: "↑ ↓", what: "move the cursor in a list" },
  ];

  const VIM: { key: string; what: string }[] = [
    { key: "j / k", what: "move the cursor down / up" },
    { key: "gg / G", what: "first / last row" },
    { key: "⏎ / esc", what: "open / back" },
    { key: "/", what: "focus the search box" },
    { key: "n / N", what: "next / previous match" },
    { key: "h / l", what: "previous / next section" },
    { key: "⇧h / ⇧l", what: "previous / next subnav tab" },
    { key: "^d / ^u", what: "scroll half a page" },
  ];
</script>

<svelte:window onkeydown={capturing ? capture : undefined} />

<div class="grid">
  <Panel title="sections">
    <p class="hint">
      The keys that switch between the tabs at the top of the window.
    </p>
    <ul class="binds">
      {#each nav as n, i}
        <li>
          <span class="what">{n.label}</span>
          <button
            class="key"
            class:arming={capturing?.kind === "nav" && capturing.item === n.key}
            onclick={() => arming({ kind: "nav", item: n.key })}
          >
            {capturing?.kind === "nav" && capturing.item === n.key
              ? "press a key…"
              : label(navKey(n.key, i))}
          </button>
          {#if keymap.nav[n.key]}
            <button
              class="clear"
              title="back to {label(defaultNavKey(i))}"
              onclick={() => setNavKey(n.key, null)}>reset</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  </Panel>

  <Panel title="subnav">
    <p class="hint">
      The keys that switch tabs inside a section, by position — slot 1 is the
      leftmost tab wherever you are.
    </p>
    <ul class="binds">
      {#each { length: SUBNAV_SLOTS } as _, i}
        <li>
          <span class="what">slot {i + 1}</span>
          <button
            class="key"
            class:arming={capturing?.kind === "subnav" && capturing.slot === i}
            onclick={() => arming({ kind: "subnav", slot: i })}
          >
            {capturing?.kind === "subnav" && capturing.slot === i
              ? "press a key…"
              : label(subnavKey(i))}
          </button>
          {#if keymap.subnav[i]}
            <button
              class="clear"
              title="back to {label(defaultSubnavKey(i))}"
              onclick={() => setSubnavKey(i, null)}>reset</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  </Panel>

  <div class="wide">
    <Panel title="vim controls">
      <label class="toggle">
        <Checkbox
          checked={vimState.enabled}
          ariaLabel="vim controls"
          onchange={setVim}
        />
        <VimMark size="1.4em" />
        <span>Navigate lists and sections with vim motions</span>
      </label>
      <ul class="ref" class:off={!vimState.enabled}>
        {#each VIM as r}
          <li><kbd>{r.key}</kbd><span>{r.what}</span></li>
        {/each}
      </ul>
    </Panel>
  </div>

  <div class="wide">
    <Panel title="fixed">
      <p class="hint">
        These are the same everywhere and cannot be rebound. A section key set
        above will shadow one of them if you assign it here.
      </p>
      <ul class="ref">
        {#each REFERENCE as r}
          <li><kbd>{r.key}</kbd><span>{r.what}</span></li>
        {/each}
      </ul>
    </Panel>
  </div>
</div>

{#if warning}<p class="warn" role="alert">{warning}</p>{/if}
{#if customized}
  <div class="reset-all">
    <Button variant="ghost" size="sm" onclick={resetKeys}
      >reset all keys</Button
    >
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: var(--pad-4);
    align-items: start;
  }
  .wide {
    grid-column: 1 / -1;
  }

  .hint {
    margin: 0 0 var(--pad-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .binds,
  .ref {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .binds li,
  .ref li {
    display: flex;
    align-items: center;
    gap: var(--gap);
    min-height: var(--row-h);
  }
  .what {
    flex: 1;
    min-width: 0;
  }

  .key {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    min-width: 7rem;
    cursor: pointer;
    color: var(--accent);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    padding: var(--pad-1) var(--pad-2);
  }
  .key.arming {
    border-color: var(--accent);
    color: var(--text);
  }
  .clear {
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
    background: none;
    border: none;
    color: var(--muted);
  }
  .clear:hover {
    color: var(--text);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: var(--gap);
    cursor: pointer;
  }

  .ref {
    margin-top: var(--pad-3);
  }
  .ref.off {
    opacity: 0.5;
  }
  .ref li {
    min-height: 0;
  }
  .ref kbd {
    min-width: 7rem;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  .ref span {
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  .warn {
    margin: var(--pad-3) 0 0;
    font-size: var(--fs-xs);
    color: var(--warn);
  }
  .reset-all {
    margin-top: var(--pad-3);
  }
</style>
