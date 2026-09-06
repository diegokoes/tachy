<script lang="ts">
  import { onMount } from "svelte";
  import { reducedMotion } from "./gsap";

  /* The wordmark used to be the app Panel's title. It now sits at the left of
     the top row as a field of particles sampled from the text itself: present,
     but at wallpaper weight, so it never competes with the nav beside it. */
  const TEXT = "TACHY";
  /**
   * Samples per cap height. This, not an absolute pixel step, is what decides
   * whether a letter holds its shape: the curves in C and the diagonals in A
   * and Y need a fixed number of rows to read as curves rather than as stairs,
   * however large the mark is drawn.
   */
  const ROWS = 15;
  /**
   * Dot radius as a fraction of the sample step. Around 0.33 leaves a third of
   * the step as gap, which is what keeps this reading as particles rather than
   * as solid text with soft edges; push it past ~0.45 and the dots merge.
   */
  const DOT_RATIO = 0.33;
  /**
   * Alpha above which a sample counts as ink. Well under half: antialiased
   * edge pixels are most of what defines a curve, and dropping them is what
   * made the round letters look chewed.
   */
  const INK = 90;
  const SCATTER = 52;
  const RETURN = 0.1;

  type P = { x: number; y: number; ox: number; oy: number };

  let canvas = $state<HTMLCanvasElement>();
  let box = $state<HTMLDivElement>();

  onMount(() => {
    const cv = canvas;
    const host = box;
    if (!cv || !host) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let particles: P[] = [];
    let dot = 1.2;
    let dpr = 1;
    let raf = 0;
    let px = -1e6;
    let py = -1e6;
    let settled = false;

    function build() {
      if (!cv || !host || !ctx) return;
      // Sample at 2x the display resolution regardless of the screen: the grid
      // below is what sets the mark's density, and reading it off a sharper
      // render is what keeps a curve from quantising into a staircase.
      dpr = Math.max(2, Math.min(window.devicePixelRatio || 1, 3));
      const w = host.clientWidth;
      const h = host.clientHeight;
      // A hidden or not-yet-laid-out host measures zero, and getImageData
      // throws on a zero-area rect. The ResizeObserver can hit this.
      if (!w || !h) return;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);

      const face = getComputedStyle(host).getPropertyValue("--font-ui");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = `700 ${Math.round(h * 0.82)}px ${face}`;
      // Loosened so adjacent letters keep a clear gutter at this sample
      // density — at 0 the A and C of TACHY bleed into one shape.
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${(h * 0.05).toFixed(1)}px`;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillStyle = "#fff";

      /* Centre on the glyphs actually drawn, not on the font's line box. The
         box carries ascender and descender space TACHY never uses, so centring
         on it left the mark visibly high in its slot. */
      const m = ctx.measureText(TEXT);
      const capTop = m.actualBoundingBoxAscent;
      const capBottom = m.actualBoundingBoxDescent;
      const capHeight = capTop + capBottom || h * 0.6;
      ctx.fillText(TEXT, 1, (h + capHeight) / 2 - capBottom);

      // Step from the cap height so density holds at any size, then read the
      // glyphs back and keep one particle per inked sample.
      const step = Math.max(2, (capHeight * dpr) / ROWS);
      dot = (step / dpr) * DOT_RATIO;
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      particles = [];
      for (let y = 0; y < cv.height; y += step) {
        const row = Math.floor(y) * cv.width;
        for (let x = 0; x < cv.width; x += step) {
          if (data[(row + Math.floor(x)) * 4 + 3] > INK) {
            const ox = x / dpr;
            const oy = y / dpr;
            particles.push({ x: ox, y: oy, ox, oy });
          }
        }
      }
      settled = false;
    }

    function draw() {
      if (!cv || !ctx) return;
      const ink = getComputedStyle(document.documentElement)
        .getPropertyValue("--wordmark-ink")
        .trim();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
      ctx.fillStyle = ink;
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, dot, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function frame() {
      let moving = false;
      for (const p of particles) {
        const dx = p.x - px;
        const dy = p.y - py;
        const dist = Math.hypot(dx, dy);
        if (dist < SCATTER) {
          const force = (SCATTER - dist) / SCATTER;
          p.x += (dx / (dist || 1)) * force * 5;
          p.y += (dy / (dist || 1)) * force * 5;
        }
        p.x += (p.ox - p.x) * RETURN;
        p.y += (p.oy - p.y) * RETURN;
        if (Math.abs(p.ox - p.x) > 0.05 || Math.abs(p.oy - p.y) > 0.05)
          moving = true;
      }
      draw();
      // Park the loop once everything is home — this is decoration, and it has
      // no business holding a rAF open for the life of the session.
      if (!moving && px < -1e5) {
        settled = true;
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    function wake() {
      settled = false;
      if (!raf) raf = requestAnimationFrame(frame);
    }

    build();
    draw();

    /*
     * Resize and theme still have to redraw under reduced motion — the mark is
     * painted to a canvas, so nothing repaints it on its own. Returning here,
     * as this used to, left those viewers with a wordmark stuck in the previous
     * theme's colours at the previous size. Only the pointer chase is motion.
     */
    const reduced = reducedMotion();

    const onMove = (e: PointerEvent) => {
      const b = host.getBoundingClientRect();
      px = e.clientX - b.left;
      py = e.clientY - b.top;
      wake();
    };
    // Snapping home is a single decision: park the cursor out of range and let
    // the same lerp carry every particle back.
    const onLeave = () => {
      px = -1e6;
      py = -1e6;
      wake();
    };

    if (!reduced) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
    }

    const ro = new ResizeObserver(() => {
      build();
      draw();
    });
    ro.observe(host);

    const theme = new MutationObserver(() => {
      if (settled || !raf) draw();
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      ro.disconnect();
      theme.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  });
</script>

<div class="wordmark" bind:this={box} aria-hidden="true">
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  /* Sized, not positioned — App places it at the left of the top row, on the
     window's left edge, where it can actually receive the pointer. */
  .wordmark {
    width: 11rem;
    height: 2.9rem;
    user-select: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
