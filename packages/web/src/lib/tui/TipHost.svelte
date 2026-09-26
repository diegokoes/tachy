<script lang="ts">
  import { float } from "./float";
  import { portal } from "./portal";
  import { dismissTip, holdTip, releaseTip, tipState } from "./tip.svelte";
</script>

<svelte:window
  onkeydowncapture={(e) => {
    if (e.key === "Escape") dismissTip();
  }}
/>

{#if tipState.anchor}
  {#key tipState.anchor}
    <span
      class="tip"
      aria-hidden="true"
      use:portal
      use:float={{
        anchor: tipState.anchor ?? undefined,
        placement: "above-start",
        gap: 6,
      }}
      onpointerenter={holdTip}
      onpointerleave={releaseTip}>{tipState.text}</span
    >
  {/key}
{/if}

<style>
  .tip {
    z-index: calc(var(--z-overlay) + 1);
    width: max-content;
    max-width: min(38ch, calc(100vw - 2rem));
    padding: var(--pad-1) var(--pad-2);
    border: var(--panel-line);
    border-radius: var(--radius);
    background: var(--panel-solid);
    box-shadow: 0 2px 8px var(--drop);
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: var(--text);
    white-space: normal;
  }
</style>
