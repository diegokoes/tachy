<script lang="ts">
  import { keyLabel } from "../keys/bindings.svelte";
  import {
    boundKey,
    customized,
    defaultKey,
    open,
    type Target,
  } from "./rebind.svelte";
  import Chord from "./Chord.svelte";

  let { label, target }: { label: string; target: Target } = $props();

  const chord = $derived(boundKey(target));
  const changed = $derived(customized(target));
</script>

<button
  class="bind"
  aria-label="rebind {label}, now {keyLabel(chord)}"
  onclick={() => open(target, label)}
>
  <span class="what">{label}</span>
  {#if changed}
    <span class="changed">was {keyLabel(defaultKey(target))}</span>
  {/if}
  <span class="leader" aria-hidden="true"></span>
  <Chord {chord} />
</button>

<style>
  .bind {
    display: flex;
    align-items: center;
    gap: var(--gap);
    width: 100%;
    min-height: var(--row-h);
    padding: var(--pad-1) var(--pad-2);
    margin: 0 calc(-1 * var(--pad-2));
    box-sizing: content-box;
    font: inherit;
    text-align: left;
    color: var(--text);
    background: none;
    border: none;
    border-radius: var(--radius-control);
    cursor: pointer;
  }
  .bind:hover,
  .bind:focus-visible {
    background: var(--accent-dim);
    outline: none;
  }
  .what {
    font-size: var(--fs-sm);
  }
  .changed {
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  /* Dots from the name to its keys, so a wide column still reads across. */
  .leader {
    flex: 1;
    min-width: var(--pad-4);
    align-self: center;
    border-bottom: 1px dotted var(--border);
  }
</style>
