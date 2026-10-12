<script lang="ts">
  import { onMount } from "svelte";
  import { gsap, reducedMotion } from "./gsap";
  import { twinkle, type Star } from "./stars";

  /**
   * A patch of sky filling its positioned parent, where StarField fills the
   * viewport: no motes and no cursor repel, since a pointer over a surface is
   * there to pick something. Coloured by --star-ink, so a second layer over
   * the same `stars` can light them up by setting only that.
   */
  let { stars, still = false }: { stars: Star[]; still?: boolean } = $props();

  let root = $state<HTMLDivElement>();

  onMount(() => {
    if (!root || still || reducedMotion()) return;
    const els = root.children;
    const ctx = gsap.context(() => {
      stars.forEach((star, i) => {
        const el = els[i];
        if (el) twinkle(el, star);
      });
    }, root);
    return () => ctx.revert();
  });
</script>

<div class="stars" bind:this={root} aria-hidden="true">
  {#each stars as s}
    <span
      class="star"
      style="left:{s.x}%; top:{s.y}%; font-size:{s.size}rem; opacity:{s.dim}"
      >{s.glyph}</span
    >
  {/each}
</div>

<style>
  .stars {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
    contain: layout paint style;
  }
  .star {
    position: absolute;
    font-family: var(--font-mono);
    line-height: 1;
    color: var(--star-ink);
  }
</style>
