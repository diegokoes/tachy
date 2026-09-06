<script lang="ts">
  import { onMount } from "svelte";
  import { gsap, reducedMotion } from "../gsap";
  import { PULSE } from "../motion";

  /* Element, not HTMLElement: `to` is the tab's frame <svg>, and everything
     done with these ends is getBoundingClientRect and ResizeObserver.observe,
     both of which are defined on Element. */
  let { from, to }: { from?: Element; to?: Element } = $props();

  let svg = $state<SVGSVGElement>();
  let core = $state<SVGPathElement>();
  let halo = $state<SVGPathElement>();
  let comet = $state<SVGPathElement>();
  let bead = $state<SVGRectElement>();
  let sparkEl = $state<SVGCircleElement>();
  let d = $state("");

  const JAGS = 10;
  const still = reducedMotion();
  let frozen = false;
  let charge: gsap.core.Tween | undefined;

  /* One packet per cycle: it runs during the first half and the wire rests
     through the second, so every arrival still lands on a growth peak of the
     tab icon (see PULSE). Variance lives in the packet's character — never in
     its timing, which would break that sync. */
  const CYCLE = PULSE * 2;

  type Packet = {
    back: boolean;
    idle: boolean;
    size: number;
    tail: number;
    ease: string;
    alpha: number;
    flash: number;
  };

  const roll = (): Packet => {
    const back = Math.random() < 0.16;
    const weak = !back && Math.random() < 0.28;
    return {
      back,
      idle: !back && Math.random() < 0.12,
      size: weak ? 3 : gsap.utils.random(4, 6),
      tail: weak ? 0.05 : gsap.utils.random(0.1, 0.26),
      ease: gsap.utils.random(["none", "power1.in", "power1.out", "power2.in"]),
      alpha: weak ? 0.45 : 1,
      flash: weak ? 0 : back ? 0.5 : 1,
    };
  };

  let packet = roll();

  let nextJag = 90;

  function jag() {
    if (!svg || !from || !to || frozen) return;
    const o = svg.getBoundingClientRect();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x1 = a.right - o.left - 1;
    const x2 = b.left - o.left;
    const y2 = b.top + b.height / 2 - o.top;
    /* Level with the tab, not with the dialog's own centre: the dialog is
       centred on the viewport and the tab on the transcript, so aiming at both
       centres left the wire running downhill. Held off the corners so the join
       stays on the dialog's edge whatever height it is. */
    const EDGE = 10;
    const y1 = Math.min(
      Math.max(y2, a.top - o.top + EDGE),
      a.bottom - o.top - EDGE,
    );
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    // Mostly a taut wire; now and then it cracks wide for one frame.
    const amp = still ? 0 : Math.random() < 0.09 ? 10 + Math.random() * 8 : 3 + Math.random() * 4;

    let path = `M${x1.toFixed(1)} ${y1.toFixed(1)}`;
    for (let i = 1; i < JAGS; i++) {
      const t = i / JAGS;
      const k = Math.sin(t * Math.PI) * amp * (Math.random() * 2 - 1);
      path += `L${(x1 + dx * t + nx * k).toFixed(1)} ${(y1 + dy * t + ny * k).toFixed(1)}`;
    }
    d = `${path}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  const hide = () => {
    if (bead) gsap.set(bead, { opacity: 0 });
    if (comet) gsap.set(comet, { opacity: 0 });
  };

  /** Rides the bolt, dragging a lit stretch of wire behind it. */
  function ride(p: number, k: Packet) {
    if (!core || !bead || !d) return;
    const at = k.back ? 1 - p : p;
    const pt = core.getPointAtLength(at * core.getTotalLength());
    const gone = p >= 1;
    const fade = gone ? 0 : Math.min(1, p * 6) * k.alpha;
    gsap.set(bead, {
      attr: {
        x: pt.x - k.size / 2,
        y: pt.y - k.size / 2,
        width: k.size,
        height: k.size,
      },
      opacity: fade,
    });
    if (!comet) return;
    const drag = k.back ? Math.min(1, at + k.tail) : Math.max(0, at - k.tail);
    const [s0, s1] = k.back ? [at, drag] : [drag, at];
    gsap.set(comet, {
      drawSVG: `${(s0 * 100).toFixed(1)}% ${(s1 * 100).toFixed(1)}%`,
      opacity: fade * 0.6,
    });
  }

  /** The wire brightening as charge lands, plus a spark at the point of entry. */
  function absorb(at: number, strength: number) {
    if (still || strength <= 0 || !core) return;
    for (const [el, rest, lift] of [
      [core, 0.7, 0.3],
      [halo, 0.16, 0.3],
    ] as const) {
      if (!el) continue;
      gsap.fromTo(
        el,
        { opacity: rest },
        {
          opacity: rest + lift * strength,
          duration: 0.11,
          yoyo: true,
          repeat: 1,
          ease: "power2.out",
          clearProps: "opacity",
        },
      );
    }
    if (!sparkEl) return;
    const pt = core.getPointAtLength(at * core.getTotalLength());
    gsap.killTweensOf(sparkEl);
    gsap.set(sparkEl, { attr: { cx: pt.x, cy: pt.y, r: 1 }, opacity: 0.9 });
    gsap.to(sparkEl, {
      attr: { r: 3 + 4 * strength },
      opacity: 0,
      duration: 0.3 + 0.12 * strength,
      ease: "power2.out",
    });
  }

  /**
   * The commit send: one fat packet, then `done` — the caller lights the tab and
   * closes the picker behind it.
   */
  export function discharge(done: () => void) {
    if (still || !core) {
      done();
      return;
    }
    charge?.kill();
    const shot: Packet = {
      back: false,
      idle: false,
      size: 9,
      tail: 0.42,
      ease: "power2.in",
      alpha: 1,
      flash: 1.6,
    };
    const curve = gsap.parseEase(shot.ease);
    const head = { p: 0 };
    charge = gsap.to(head, {
      p: 1,
      duration: 0.42,
      ease: "none",
      onUpdate: () => ride(curve(head.p), shot),
      onComplete: () => {
        hide();
        absorb(1, shot.flash);
        done();
      },
    });
  }

  $effect(() => {
    if (!svg || !from || !to) return;
    jag();
    const ro = new ResizeObserver(() => jag());
    ro.observe(from);
    ro.observe(to);
    return () => ro.disconnect();
  });

  onMount(() => {
    if (still) return;

    let since = 0;
    /* Whether either endpoint has moved since the last frame. The tab's
       open/close grow is a transform, which changes no layout box — so the
       ResizeObserver above never fires for it and the wire would hang off the
       hexagon's old edge until the next random flicker. Watching the client
       rect catches it, and catches anything else that moves an end. */
    let anchors = "";
    const moved = () => {
      if (!from || !to) return false;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const sig = `${a.right.toFixed(1)},${a.top.toFixed(1)},${a.height.toFixed(1)}|${b.left.toFixed(1)},${b.top.toFixed(1)},${b.height.toFixed(1)}`;
      if (sig === anchors) return false;
      anchors = sig;
      return true;
    };

    const flicker = (_t: number, dt: number) => {
      if (moved()) {
        since = 0;
        jag();
        return;
      }
      since += dt;
      if (since < nextJag) return;
      since = 0;
      nextJag = 60 + Math.random() * 100;
      jag();
    };
    gsap.ticker.add(flicker);

    // Travels while the tab's dots grow, rests while they shrink: created in
    // the same frame as spin(), so every arrival lands on a peak.
    const cycle = { t: 0 };
    let landed = false;
    charge = gsap.to(cycle, {
      t: 1,
      duration: CYCLE,
      ease: "none",
      repeat: -1,
      onRepeat: () => {
        packet = roll();
        landed = false;
        hide();
      },
      onUpdate: () => {
        if (packet.idle || landed) return;
        const p = Math.min(1, cycle.t * 2);
        ride(gsap.parseEase(packet.ease)(p), packet);
        if (p >= 1 && !landed) {
          landed = true;
          hide();
          absorb(packet.back ? 0 : 1, packet.flash);
        }
      },
    });

    const onResize = () => jag();
    window.addEventListener("resize", onResize);
    return () => {
      gsap.ticker.remove(flicker);
      charge?.kill();
      window.removeEventListener("resize", onResize);
    };
  });

  /** Strikes out of the panel and into the tab; reverses back on close. */
  function strike(_node: Element, { retract = false } = {}) {
    if (still) return { duration: 0 };
    return {
      duration: retract ? 220 : 420,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      tick: (t: number) => {
        if (!core || !halo) return;
        const cut = ((retract ? 1 - t : 0) * 100).toFixed(1);
        const grown = ((retract ? 1 : t) * 100).toFixed(1);
        gsap.set([core, halo], { drawSVG: `${cut}% ${grown}%` });
      },
    };
  }

  /** The dash the draw-in left behind would clip the flickering path. */
  function settleStroke() {
    if (core && halo)
      gsap.set([core, halo], { clearProps: "strokeDasharray,strokeDashoffset" });
  }
</script>

<svg
  bind:this={svg}
  class="thread"
  aria-hidden="true"
  in:strike
  out:strike={{ retract: true }}
  onintroend={settleStroke}
  onoutrostart={() => (frozen = true)}
>
  <path bind:this={halo} class="halo" {d} />
  <path bind:this={core} class="core" {d} />
  {#if !still}
    <path bind:this={comet} class="comet" {d} opacity="0" />
    <circle bind:this={sparkEl} class="spark" r="1" opacity="0" />
    <rect bind:this={bead} class="bead" width="4" height="4" opacity="0" />
  {/if}
</svg>

<style>
  /* Above the picker's scrim, not under it: the scrim's blur is what puts the
     app on a plane behind the dialog, and a wire drawn into that plane reads
     as part of what was pushed back. It has to arrive on top of the blur for
     the dialog and the tab to look connected. */
  .thread {
    position: absolute;
    inset: 0;
    z-index: calc(var(--z-overlay) + 1);
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  .halo {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3;
    opacity: 0.16;
    filter: blur(2px);
  }
  .core {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
    opacity: 0.7;
  }
  /* The lit stretch of wire the packet drags behind it. */
  .comet {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .bead {
    fill: var(--accent);
    filter: drop-shadow(0 0 3px var(--accent));
  }
  .spark {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
  }
</style>
