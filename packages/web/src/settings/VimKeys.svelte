<script lang="ts">
  import { slide } from "svelte/transition";
  import { VIM_KEYS, vimState, setVim } from "../keys/vim.svelte";
  import { tip, VimMark } from "../tui";
  import RefList from "./RefList.svelte";

  const on = $derived(vimState.enabled);
</script>

<button
  class="mark"
  class:on
  aria-pressed={on}
  aria-label="vim motions"
  use:tip={on ? "vim motions on" : "vim motions off"}
  onclick={() => setVim(!on)}
>
  <VimMark size="2.6rem" />
</button>

{#if on}
  <div class="keys" transition:slide={{ duration: 180 }}>
    <RefList rows={VIM_KEYS} />
  </div>
{/if}

<style>
  .mark {
    display: flex;
    margin: 0 auto;
    padding: var(--pad-2);
    color: var(--muted);
    background: none;
    border: none;
    border-radius: var(--radius-control);
    cursor: pointer;
    opacity: 0.55;
    transition:
      color 0.2s ease,
      opacity 0.2s ease,
      filter 0.2s ease;
  }
  .mark:hover {
    opacity: 0.85;
  }
  .mark:focus-visible {
    outline: 1px solid var(--accent);
  }
  .mark.on {
    color: var(--ok);
    opacity: 1;
    filter: drop-shadow(
      0 0 0.6rem color-mix(in srgb, var(--ok) 55%, transparent)
    );
  }
  .keys {
    padding-top: var(--pad-2);
  }
</style>
