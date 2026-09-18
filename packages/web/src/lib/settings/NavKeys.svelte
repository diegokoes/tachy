<script lang="ts">
  import { navItems } from "../nav";
  import {
    keymap,
    keyLabel,
    navKey,
    settingsKey,
    setNavKey,
    resetKeys,
    defaultNavKey,
    defaultSettingsKey,
  } from "../keys/bindings.svelte";
  import { Button } from "../tui";
  import { arm, isArming, rebind } from "./rebind.svelte";

  const nav = $derived(navItems());

  const customized = $derived(
    Object.keys(keymap.nav).length + Object.keys(keymap.subnav).length > 0,
  );
</script>

<p class="hint">The keys that switch between the tabs at the top of the window.</p>

<ul class="binds">
  {#each nav as n, i}
    <li>
      <span class="what">{n.label}</span>
      <button
        class="key"
        class:armed={isArming({ kind: "nav", item: n.key })}
        onclick={() => arm({ kind: "nav", item: n.key })}
      >
        {isArming({ kind: "nav", item: n.key })
          ? "press a key…"
          : keyLabel(navKey(n.key, i))}
      </button>
      {#if keymap.nav[n.key]}
        <button
          class="clear"
          title="back to {keyLabel(defaultNavKey(i))}"
          onclick={() => setNavKey(n.key, null)}>reset</button
        >
      {/if}
    </li>
  {/each}

  <li>
    <span class="what">settings</span>
    <button
      class="key"
      class:armed={isArming({ kind: "settings" })}
      onclick={() => arm({ kind: "settings" })}
    >
      {isArming({ kind: "settings" })
        ? "press a key…"
        : keyLabel(settingsKey())}
    </button>
    {#if keymap.nav.settings}
      <button
        class="clear"
        title="back to {keyLabel(defaultSettingsKey)}"
        onclick={() => setNavKey("settings", null)}>reset</button
      >
    {/if}
  </li>
</ul>

{#if rebind.warning}<p class="warn" role="alert">{rebind.warning}</p>{/if}

{#if customized}
  <div class="reset-all">
    <Button variant="ghost" size="sm" onclick={resetKeys}>reset all keys</Button>
  </div>
{/if}

<style>
  .hint {
    margin: 0 0 var(--pad-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .binds {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .binds li {
    display: flex;
    align-items: center;
    gap: var(--gap);
    min-height: var(--row-h);
  }
  .what {
    flex: 0 0 8rem;
    min-width: 0;
    font-size: var(--fs-sm);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
  }

  /* Wide enough for the longest spelled-out chord — "DOWN ARROW" — so the row
     does not jump width as you rebind it. */
  .key {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    min-width: 10rem;
    cursor: pointer;
    color: var(--accent);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    padding: var(--pad-1) var(--pad-2);
  }
  .key.armed {
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

  .warn {
    margin: var(--pad-3) 0 0;
    font-size: var(--fs-xs);
    color: var(--warn);
  }
  .reset-all {
    margin-top: var(--pad-3);
  }
</style>
