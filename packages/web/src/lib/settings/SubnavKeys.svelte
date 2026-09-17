<script lang="ts">
  import {
    keymap,
    keyLabel,
    subnavKey,
    setSubnavKey,
    defaultSubnavKey,
  } from "../keys/bindings.svelte";
  import { arm, isArming, rebind, SUBNAV_SLOTS } from "./rebind.svelte";
</script>

<p class="hint">
  The keys that switch tabs inside a section, by position — slot 1 is the
  leftmost tab wherever you are. Settings itself has no tabs, so they do nothing
  here.
</p>

<ul class="binds">
  {#each { length: SUBNAV_SLOTS } as _, i}
    <li>
      <span class="what">slot {i + 1}</span>
      <button
        class="key"
        class:armed={isArming({ kind: "subnav", slot: i })}
        onclick={() => arm({ kind: "subnav", slot: i })}
      >
        {isArming({ kind: "subnav", slot: i })
          ? "press a key…"
          : keyLabel(subnavKey(i))}
      </button>
      {#if keymap.subnav[i]}
        <button
          class="clear"
          title="back to {keyLabel(defaultSubnavKey(i))}"
          onclick={() => setSubnavKey(i, null)}>reset</button
        >
      {/if}
    </li>
  {/each}
</ul>

{#if rebind.warning}<p class="warn" role="alert">{rebind.warning}</p>{/if}

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
</style>
