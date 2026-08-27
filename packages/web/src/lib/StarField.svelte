<script lang="ts">
  import { onMount } from "svelte";
  import { gsap, reducedMotion } from "./gsap";

  /* The wallpaper used to be one <pre> holding a ~650-column ASCII starfield.
     It read well but it was a single text node, so nothing in it could move
     independently. These are the same glyphs, one span each, scattered on a
     jittered grid so the field still looks hand-placed rather than tiled. */
  const GLYPHS = ["·", "·", "·", "*", "+", "'"];
  /* Density is the whole difference between "a sky" and "a few specks". At 220
     over a 1920-wide viewport the mean spacing was ~97px, so the ~160px gutter
     either side of the app window held one sparse column and read as empty. */
  const COUNT = 460;
  const MOTES = 22;
  /** Cursor influence, px. Also the bucket size, so a move tests ~9 buckets. */
  const REPEL = 90;

  type Star = {
    glyph: string;
    x: number;
    y: number;
    size: number;
    dim: number;
    el?: HTMLSpanElement;
    xTo?: (v: number) => void;
    yTo?: (v: number) => void;
  };

  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  // Percentages, so the field reflows with the viewport without re-laying out.
  const stars: Star[] = Array.from({ length: COUNT }, () => ({
    glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
    x: rand(0, 100),
    y: rand(0, 100),
    size: rand(0.6, 1.25),
    // Floor raised off 0.35: multiplied into --star-ink and then again by the
    // twinkle, the faintest stars were landing near 5% alpha — present in the
    // DOM, invisible on screen.
    dim: rand(0.6, 1),
  }));

  const motes: Star[] = Array.from({ length: MOTES }, () => ({
    glyph: "·",
    x: rand(0, 100),
    y: rand(20, 100),
    size: rand(0.5, 0.9),
    dim: rand(0.4, 0.9),
  }));

  let root = $state<HTMLDivElement>();
  /** star index by "col:row" bucket, so a pointermove never scans all 220. */
  const buckets = new Map<string, Star[]>();

  function rebucket(w: number, h: number) {
    buckets.clear();
    for (const s of stars) {
      const key = `${Math.floor(((s.x / 100) * w) / REPEL)}:${Math.floor(((s.y / 100) * h) / REPEL)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(s);
    }
  }

  onMount(() => {
    if (!root || reducedMotion()) return;

    for (const s of [...stars, ...motes]) {
      if (!s.el) continue;
      s.xTo = gsap.quickTo(s.el, "x", { duration: 0.9, ease: "power2.out" });
      s.yTo = gsap.quickTo(s.el, "y", { duration: 0.9, ease: "power2.out" });
    }

    const ctx = gsap.context(() => {
      // Twinkle. Long, offset durations so the field never pulses in unison —
      // synchronised blinking reads as a loading state, not as sky.
      for (const s of stars) {
        if (!s.el) continue;
        gsap.to(s.el, {
          // A twinkle, not a blink: dipping to a quarter made half the field
          // read as flickering out rather than breathing.
          opacity: s.dim * rand(0.5, 0.75),
          duration: rand(3, 7),
          delay: rand(0, 6),
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      }

      // Slow rising motes: the only thing here with a direction.
      for (const m of motes) {
        if (!m.el) continue;
        gsap.fromTo(
          m.el,
          { y: 0, x: 0, opacity: m.dim },
          {
            y: rand(-150, -50),
            x: rand(-30, 30),
            opacity: 0,
            // Much slower than a normal particle emitter. At emitter speed this
            // reads as weather; at this speed you only notice it if you look.
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
          for (const s of buckets.get(`${cx}:${cy}`) ?? []) {
            const dx = (s.x / 100) * w - px;
            const dy = (s.y / 100) * h - py;
            const dist = Math.hypot(dx, dy);
            if (dist > REPEL) {
              s.xTo?.(0);
              s.yTo?.(0);
              continue;
            }
            // Push away, hardest at the centre, easing back once out of range.
            const force = ((REPEL - dist) / REPEL) * 26;
            s.xTo?.((dx / (dist || 1)) * force);
            s.yTo?.((dy / (dist || 1)) * force);
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
    /* Not `strict` — that adds size containment, and this element takes its
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
