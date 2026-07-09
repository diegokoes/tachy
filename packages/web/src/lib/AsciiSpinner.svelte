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
    gap: 0.45rem;
    padding: 0.9rem 1.2rem;
    /* dim what's behind so the ANSI colors read on any pattern */
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border-radius: 6px;
  }

  pre {
    margin: 0;
    font: 14px/1.3 ui-monospace, monospace;
    user-select: none;
  }

  .label {
    font-size: 0.78rem;
    letter-spacing: 0.14em;
    color: #e5e5e5; /* ansi white */
  }

  /* DOS ANSI16, dark mode: bright black frame, bright cyan comet */
  .dim { color: #666666; }
  .lit { color: #29b8db; }

  /* Light mode: base ANSI variants  brights wash out on the light page. */
  :global([data-theme="light"]) .label { color: #000000; }
  :global([data-theme="light"]) .lit { color: #11a8cd; }
</style>
