<script lang="ts">
  
  
  
  
  
  import { onMount } from "svelte";
  import { reducedMotion } from "./gsap";

  let { label = "loading" }: { label?: string } = $props();

  const W = 16; 
  const EDGE = "═".repeat(W + 2);

  let tick = $state(0);
  let visible = $state(false);
  let reduced = $state(false);

  const bar = $derived.by(() => {
    const p = tick % (W + 5); 
    let s = "";
    for (let i = 0; i < W; i++) {
      const d = p - i;
      s += d === 0 ? "█" : d === 1 ? "▓" : d === 2 ? "▒" : d === 3 ? "░" : "·";
    }
    return s;
  });

  onMount(() => {
    reduced = reducedMotion();
    visible = true; 
    const iv = reduced ? undefined : setInterval(() => tick++, 90);
    return () => {
      if (iv !== undefined) clearInterval(iv);
    };
  });
</script>

<div class="ascii-spinner" class:visible role="status" aria-label={label}>
  <div class="inner">
    {#if reduced}
      <div class="label">{label}…</div>
    {:else}
      <pre aria-hidden="true"><span class="dim">╔{EDGE}╗</span>
<span class="dim">║ </span>{#each bar.split("") as ch}<span class={ch === "·" ? "dim" : "lit"}>{ch}</span>{/each}<span class="dim"> ║</span>
<span class="dim">╚{EDGE}╝</span></pre>
      <div class="label">{label}…</div>
    {/if}
  </div>
</div>

<style>
  .ascii-spinner {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .ascii-spinner.visible { opacity: 1; }

  .inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-3);
    padding: var(--pad-4);
    /* dim what's behind so the comet reads on any pattern */
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border-radius: var(--radius);
  }

  pre {
    margin: 0;
    font: 14px/1.3 ui-monospace, monospace;
    user-select: none;
  }

  .label {
    font-size: var(--fs-xs);
    letter-spacing: 0.14em;
    color: var(--text);
  }

  .dim { color: var(--muted); }
  .lit { color: var(--accent); }
</style>
