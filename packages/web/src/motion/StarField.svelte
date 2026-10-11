<script lang="ts">
  import { onMount } from "svelte";
  import { gsap, reducedMotion } from "./gsap";
  import { rand, scatter, twinkle, type Star } from "./stars";

  /** Density decides whether this reads as a sky or a few specks. At 220 on a
   *  1920px viewport the mean spacing is ~97px, and the ~160px gutter beside
   *  the app window holds one sparse column, which reads as empty. */
  const COUNT = 460;
  const MOTES = 22;
  /** Cursor influence, px. Also the bucket size, so a move tests ~9 buckets. */
  const REPEL = 90;

  /** One span per glyph, so each can move on its own. */
  type Speck = Star & {
    el?: HTMLSpanElement;
    xTo?: (value: number) => void;
    yTo?: (value: number) => void;
  };

  /** The feedback view mounts its own field with this on, so entering it reads
   *  as crossing into a new space: the stars twinkle faster and dip harder. */
  let { intense = false }: { intense?: boolean } = $props();

  const stars: Speck[] = scatter(COUNT);

  const motes: Speck[] = Array.from({ length: MOTES }, () => ({
    glyph: "·",
    x: rand(0, 100),
    y: rand(20, 100),
    size: rand(0.5, 0.9),
    dim: rand(0.4, 0.9),
  }));

  let root = $state<HTMLDivElement>();
  /** star index by "col:row" bucket, so a pointermove never scans all 220. */
  const buckets = new Map<string, Speck[]>();

  function rebucket(w: number, h: number) {
    buckets.clear();
    for (const star of stars) {
      const key = `${Math.floor(((star.x / 100) * w) / REPEL)}:${Math.floor(((star.y / 100) * h) / REPEL)}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = []));
      bucket.push(star);
    }
  }

  onMount(() => {
    if (!root || reducedMotion()) return;

    for (const speck of [...stars, ...motes]) {
      if (!speck.el) continue;
      speck.xTo = gsap.quickTo(speck.el, "x", {
        duration: 0.9,
        ease: "power2.out",
      });
      speck.yTo = gsap.quickTo(speck.el, "y", {
        duration: 0.9,
        ease: "power2.out",
      });
    }

    const ctx = gsap.context(() => {
      for (const star of stars) if (star.el) twinkle(star.el, star, intense);

      // Slow rising motes: the only thing here with a direction.
      for (const mote of motes) {
        if (!mote.el) continue;
        gsap.fromTo(
          mote.el,
          { y: 0, x: 0, opacity: mote.dim },
          {
            y: rand(-150, -50),
            x: rand(-30, 30),
            opacity: 0,
            // Much slower than a particle emitter: at emitter speed this reads
            // as weather, at this speed it is noticed only when looked at.
            duration: rand(14, 26),
            delay: rand(0, 18),
            repeat: -1,
            ease: "none",
          },
        );
      }
    }, root);

    let w = window.innerWidth;
    let h = window.innerHeight;
    rebucket(w, h);

    const onResize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      rebucket(w, h);
    };

    let queued = false;
    let px = 0;
    let py = 0;
    const nudge = () => {
      queued = false;
      const bx = Math.floor(px / REPEL);
      const by = Math.floor(py / REPEL);
      for (let cx = bx - 1; cx <= bx + 1; cx++) {
        for (let cy = by - 1; cy <= by + 1; cy++) {
          for (const star of buckets.get(`${cx}:${cy}`) ?? []) {
            const dx = (star.x / 100) * w - px;
            const dy = (star.y / 100) * h - py;
            const dist = Math.hypot(dx, dy);
            if (dist > REPEL) {
              star.xTo?.(0);
              star.yTo?.(0);
              continue;
            }
            // Push away, hardest at the centre, easing back once out of range.
            const force = ((REPEL - dist) / REPEL) * 26;
            star.xTo?.((dx / (dist || 1)) * force);
            star.yTo?.((dy / (dist || 1)) * force);
          }
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (queued) return;
      queued = true;
      requestAnimationFrame(nudge);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      ctx.revert();
    };
  });
</script>

<div class="starfield" bind:this={root} aria-hidden="true">
  {#each stars as s}
    <span
      bind:this={s.el}
      class="star"
      style="left:{s.x}%; top:{s.y}%; font-size:{s.size}rem; opacity:{s.dim}"
      >{s.glyph}</span
    >
  {/each}
  {#each motes as m}
    <span
      bind:this={m.el}
      class="star"
      style="left:{m.x}%; top:{m.y}%; font-size:{m.size}rem; opacity:{m.dim}"
      >{m.glyph}</span
    >
  {/each}
</div>

<style>
  .starfield {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
    /* Not `strict` - that adds size containment, and this element takes its
       size from inset:0. Everything else is worth having: 235 absolutely
       positioned spans should never invalidate layout above them. */
    contain: layout paint style;
  }
  .star {
    position: absolute;
    font-family: var(--font-mono);
    line-height: 1;
    color: var(--star-ink);
    will-change: transform, opacity;
  }
</style>
