<script lang="ts">
  
  
  import { onMount } from "svelte";
  import { gsap, SplitText, reducedMotion } from "./gsap";

  let { label = "searching the archive" }: { label?: string } = $props();

  let stage = $state<HTMLDivElement>();
  let visible = $state(false);
  let reduced = $state(false);

  const COPIES = 6;
  const WORD = "tachy";

  onMount(() => {
    reduced = reducedMotion();
    const t = setTimeout(() => (visible = true), 250);
    if (reduced) return () => clearTimeout(t);

    const split = new SplitText(stage!, { type: "chars" });
    const chars = split.chars;
    const cols = 10;
    const cell = 16;

    const tl = gsap.timeline({ repeat: -1 });
    tl.set(chars, { opacity: 0, x: 0, y: 0, scale: 1, rotate: 0 });
    
    tl.to(chars, {
      opacity: 1,
      x: (i) => (i * 1.6 + 14) * Math.cos(i * 5),
      y: (i) => (i * 1.1 + 10) * Math.sin(i * 5),
      scale: (i) => 0.5 + i / 80,
      ease: "elastic.out(1.2, 0.5)",
      duration: 1.6,
      stagger: 0.004,
    });
    
    tl.to(chars, {
      x: (i) => (i % cols) * cell - (cols * cell) / 2 + cell / 2,
      y: (i) => Math.floor(i / cols) * cell - cell,
      scale: 1,
      ease: "power2",
      duration: 1.1,
      stagger: -0.006,
    }, "-=0.3");
    
    tl.to(chars, {
      opacity: 0,
      x: (i) => gsap.utils.random(-90, 90, 5),
      y: (i) => gsap.utils.random(-40, 40, 5),
      rotate: 180,
      ease: "power1.in",
      duration: 0.7,
      stagger: 0.003,
    }, "+=0.4");

    return () => {
      clearTimeout(t);
      tl.kill();
      split.revert();
    };
  });
</script>

<div class="swarm" class:visible role="status" aria-label="loading">
  {#if reduced}
    <p class="muted">Loading…</p>
  {:else}
    <div class="stage" bind:this={stage} aria-hidden="true">
      {#each Array(COPIES) as _}{WORD}{/each}
    </div>
    <span class="label muted">{label}…</span>
  {/if}
</div>

<style>
  .swarm {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 1.25rem 0 0.75rem;
    opacity: 0;
    transition: opacity 0.3s;
    overflow: hidden;
  }
  .swarm.visible { opacity: 1; }
  .stage {
    position: relative;
    height: 90px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    font-size: 0.8rem;
    letter-spacing: 0.05em;
    pointer-events: none;
    user-select: none;
  }
  .label { font-size: 0.78rem; }
  .muted { color: var(--muted); }
</style>
