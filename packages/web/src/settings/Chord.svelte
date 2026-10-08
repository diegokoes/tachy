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
      <kbd class="cap" style="--i: {i * 2 + j}"
        ><span class="face">{cap}</span></kbd
      >
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
     changing at once. The six stripes of the pride flag, softened so the rim
     reads as a tint rather than a light show. */
  .live {
    --k1: rgb(228, 96, 96);
    --k2: rgb(235, 150, 80);
    --k3: rgb(230, 205, 95);
    --k4: rgb(100, 185, 115);
    --k5: rgb(90, 140, 220);
    --k6: rgb(160, 110, 205);
  }
  .live .cap {
    --delay: calc(var(--i) * 0.25s - 0.5s);
    animation: glow 7s var(--delay) linear infinite;
  }
  .live .cap::before {
    content: "";
    position: absolute;
    top: 150%;
    left: 150%;
    /* Far past the cap on every side: a smaller square, turned 45°, leaves a
       corner of the cap's rim unpainted. */
    width: 1200%;
    aspect-ratio: 1;
    background: conic-gradient(
      var(--k1),
      var(--k2),
      var(--k3),
      var(--k4),
      var(--k5),
      var(--k6),
      var(--k1)
    );
    opacity: 0.85;
    animation: spin 7s var(--delay) linear infinite;
  }
  .live .face {
    animation: ink 7s var(--delay) linear infinite;
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
      box-shadow: 0 0 1.2rem -0.5rem var(--k1);
    }
    16.6% {
      box-shadow: 0 0 1.2rem -0.5rem var(--k2);
    }
    33.3% {
      box-shadow: 0 0 1.2rem -0.5rem var(--k3);
    }
    50% {
      box-shadow: 0 0 1.2rem -0.5rem var(--k4);
    }
    66.6% {
      box-shadow: 0 0 1.2rem -0.5rem var(--k5);
    }
    83.3% {
      box-shadow: 0 0 1.2rem -0.5rem var(--k6);
    }
  }
  @keyframes ink {
    0%,
    100% {
      color: var(--k1);
    }
    16.6% {
      color: var(--k2);
    }
    33.3% {
      color: var(--k3);
    }
    50% {
      color: var(--k4);
    }
    66.6% {
      color: var(--k5);
    }
    83.3% {
      color: var(--k6);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live .cap,
    .live .cap::before,
    .live .face {
      animation: none;
    }
    .live .cap::before {
      transform: translate(-50%, -50%);
    }
  }
</style>
