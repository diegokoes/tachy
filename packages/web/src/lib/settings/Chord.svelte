<script lang="ts">
  import { keyCaps } from "../keys/bindings.svelte";

  let {
    chord,
    size = "sm",
    live = false,
    pressed = false,
  }: {
    chord: string;
    size?: "sm" | "lg";
    /** Being recorded right now: the one place a cap is allowed to glow. */
    live?: boolean;
    /** Held down right now: the caps sit in their rims. */
    pressed?: boolean;
  } = $props();

  const steps = $derived(keyCaps(chord));
</script>

<span class="chord {size}" class:live class:pressed>
  {#each steps as caps, i}
    {#if i}<span class="join">then</span>{/if}
    {#each caps as cap, j}
      {#if j}<span class="join" aria-hidden="true">+</span>{/if}
      <kbd class="cap" style="--i: {i * 2 + j}"><span class="face">{cap}</span></kbd>
    {/each}
  {/each}
</span>

<style>
  .chord {
    --face: var(--bg);
    --rim: var(--border);
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--pad-1);
    font-family: system-ui, sans-serif;
  }
  .chord.lg {
    gap: var(--pad-2);
  }

  /* A face sitting in a rim: the rim is the cap's own padding, so whatever
     paints behind the face shows only as its edge. */
  .cap {
    position: relative;
    display: inline-flex;
    padding: 1px 1px 2px;
    overflow: hidden;
    border-radius: 6px;
    background: var(--rim);
    font: inherit;
    transform: translateZ(0);
  }
  .face {
    position: relative;
    z-index: 1;
    top: -1px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5em;
    padding: 0.15em 0.45em;
    border-radius: 5px;
    background: var(--face);
    box-shadow: 0 2px 0 var(--edge-lo);
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: 500;
    line-height: 1.3;
    white-space: nowrap;
  }
  .lg .cap {
    padding: 3px 3px 5px;
    border-radius: 10px;
  }
  .lg .face {
    min-width: 3.2rem;
    min-height: 3rem;
    padding: 0 0.8rem;
    border-radius: 8px;
    font-size: var(--fs-lg);
    box-shadow: 0 4px 0 var(--edge-lo);
  }
  .face {
    transition:
      top 0.08s ease-out,
      box-shadow 0.08s ease-out;
  }
  .pressed .face {
    top: 0;
    box-shadow: 0 1px 0 var(--edge-lo);
  }
  .lg.pressed .face {
    box-shadow: 0 2px 0 var(--edge-lo);
  }
  .join {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .lg .join {
    font-size: var(--fs-sm);
  }

  /* Staggered by cap so the colour runs along the chord instead of every key
     changing at once. */
  .live .cap {
    --delay: calc(var(--i) * 0.2s - 0.5s);
    animation: glow 5s var(--delay) linear infinite;
  }
  .live .cap::before {
    content: "";
    position: absolute;
    top: 150%;
    left: 150%;
    /* Far past the cap on every side: a square cap turned 45° inside a smaller
       one left a corner of the rim unpainted once per turn. */
    width: 1200%;
    aspect-ratio: 1;
    background: conic-gradient(
      var(--key-red),
      var(--key-green),
      var(--key-blue),
      var(--key-red)
    );
    animation: spin 5s var(--delay) linear infinite;
  }
  .live .face {
    animation: ink 5s var(--delay) linear infinite;
  }
  .live {
    --key-red: rgb(255, 100, 100);
    --key-green: rgb(100, 200, 100);
    --key-blue: rgb(100, 100, 255);
  }

  @keyframes spin {
    from {
      transform: translate(-50%, -50%) rotate(0deg);
    }
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }
  @keyframes glow {
    0%,
    100% {
      box-shadow: 0 0 1.4rem -0.5rem var(--key-red);
    }
    33% {
      box-shadow: 0 0 1.4rem -0.5rem var(--key-blue);
    }
    66% {
      box-shadow: 0 0 1.4rem -0.5rem var(--key-green);
    }
  }
  @keyframes ink {
    0%,
    100% {
      color: var(--key-red);
    }
    33% {
      color: var(--key-blue);
    }
    66% {
      color: var(--key-green);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live .cap,
    .live .cap::before,
    .live .face {
      animation: none;
    }
    .live .cap::before {
      background: var(--accent);
    }
    .live .face {
      color: var(--accent);
    }
  }
</style>
