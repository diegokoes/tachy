<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { gsap, reducedMotion } from "../gsap";
  import { GRID, shapes } from "../tui/icons";

  let {
    mode = "idle",
  }: {
    /**
     * `idle` circles, waiting. `seek` is asking the source: the comets spiral
     * into the core, which swells and trembles until the answer is in. `gone`
     * is the answer out: the hole closes to nothing.
     */
    mode?: "idle" | "seek" | "gone";
  } = $props();

  type Point = { x: number; y: number };

  const C = GRID / 2;
  const ORIGIN = `${C} ${C}`;
  /** Room past the icon's own grid for the outer orbit, kept centred on it. */
  const PAD = 5;
  const uid = $props.id();

  const parts = shapes("bulk");
  const circles = parts
    .filter(([tag]) => tag === "circle")
    .map(([, a]) => a as Record<string, string>);
  const core = circles.reduce((a, b) => (Number(b.r) > Number(a.r) ? b : a));
  const moons = circles.filter((c) => c !== core);
  const tails = parts
    .filter(([tag]) => tag === "path")
    .map(([, a]) => a as Record<string, string>);

  /**
   * Per comet: head colour, tail colour, orbit scale, seconds per lap, and
   * how much of the orbit's scale the head itself takes. The
   * outer one runs faster; the inner one rides the dotted ring, and the gap
   * between them is wide enough that the two moons never touch in passing.
   */
  const COMETS = [
    { head: "a", tail: "b", scale: 1.35, lap: 4.8, moon: 0.72 },
    { head: "c", tail: "d", scale: 0.8, lap: 7.2, moon: 1 },
  ] as const;
  const RING = 8;

  /** How long the comets take to fall in. */
  const SPIRAL = 2.9;
  /**
   * When the outer head crosses the edge of the swollen core and is gone: the
   * spiral's scale eases in quadratically and the core's edge sits at about a
   * third of the outer orbit, so 1 - p² = 1/3. The inner one is in earlier.
   */
  const ENTER = SPIRAL * Math.sqrt(2 / 3);
  /** The letters leave this long after the core has taken the comets in. */
  const AFTER = 0.1;

  let svg = $state<SVGSVGElement>();
  let kick = $state<SVGGElement>();
  let ring = $state<SVGCircleElement>();
  let halo = $state<SVGGElement>();
  let swarm = $state<SVGGElement>();
  let heart = $state<SVGGElement>();
  let voidEl = $state<SVGCircleElement>();
  let coreEl = $state<SVGCircleElement>();
  let coreGrad = $state<SVGLinearGradientElement>();
  let cometEls = $state<SVGGElement[]>([]);
  let tailEls = $state<SVGPathElement[]>([]);

  /** Which moon heads which tail, and where each tail fades out. */
  let heads = $state<number[]>(tails.map((_, i) => i));
  let ends = $state<{ from: Point; to: Point }[]>([]);

  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  /* Paired by geometry once drawn, because Lucide reorders an icon's nodes
     and may reverse a path between releases: a moon heads the tail whose end
     it sits on, and the gradient runs from that tail's far end up to it.
     Each pair is then one group, so nothing can pull a head off its tail. */
  $effect(() => {
    if (tailEls.length !== tails.length) return;
    const at = moons.map((m) => ({ x: Number(m.cx), y: Number(m.cy) }));
    const pairs = tailEls.map((p) => {
      const a = p.getPointAtLength(0);
      const b = p.getPointAtLength(p.getTotalLength());
      const near = (q: Point) =>
        at.reduce(
          (best, m, i) => (dist(q, m) < dist(q, at[best]) ? i : best),
          0,
        );
      const [head, far] =
        dist(a, at[near(a)]) <= dist(b, at[near(b)]) ? [a, b] : [b, a];
      return {
        moon: near(head),
        from: { x: far.x, y: far.y },
        to: { x: head.x, y: head.y },
      };
    });
    untrack(() => {
      heads = pairs.map((p) => p.moon);
      ends = pairs.map(({ from, to }) => ({ from, to }));
    });
  });

  let loops: gsap.core.Timeline | null = null;
  let flight: gsap.core.Timeline | null = null;
  let shake: gsap.core.Tween | null = null;

  $effect(() => {
    if (!svg || !kick || !ring || !coreEl || !voidEl || !coreGrad) return;
    if (!swarm || !heart || cometEls.length !== tails.length) return;
    if (ends.length !== tails.length || reducedMotion()) return;

    /* Once, up front: an origin given only on the "to" side of a fromTo is
       resolved after the "from" state has already been drawn about 0 0. */
    gsap.set([kick, ring, coreEl, voidEl, swarm, heart, ...cometEls], {
      svgOrigin: ORIGIN,
    });

    const tl = gsap.timeline();
    tl.to(ring, { rotation: 360, duration: 40, ease: "none", repeat: -1 }, 0)
      .fromTo(
        coreGrad,
        { attr: { gradientTransform: `rotate(0 ${ORIGIN})` } },
        {
          attr: { gradientTransform: `rotate(360 ${ORIGIN})` },
          duration: 6,
          ease: "none",
          repeat: -1,
        },
        0,
      )
      .fromTo(
        [coreEl, voidEl],
        { scale: 0.92 },
        {
          scale: 1.08,
          duration: 2,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        },
        0,
      );
    cometEls.forEach((el, i) => {
      const { scale, lap } = COMETS[i % COMETS.length];
      gsap.set(el, { scale });
      tl.to(
        el,
        { rotation: "-=360", duration: lap, ease: "none", repeat: -1 },
        0,
      );
    });
    loops = tl;

    /* Already moving when it appears and only ever gathering speed: starting
       from still read as frozen, and an overshoot as a stall. */
    const arrive = gsap
      .timeline()
      .fromTo(
        kick,
        { scale: 0.6, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.6, ease: "power2.out" },
        0,
      )
      .fromTo(
        tl,
        { timeScale: 0.45 },
        {
          timeScale: untrack(() => mode) === "seek" ? 2.4 : 1,
          duration: 1.2,
          ease: "power1.out",
        },
        0,
      );
    return () => {
      tl.kill();
      arrive.kill();
      loops = null;
    };
  });

  function still() {
    flight?.kill();
    shake?.kill();
    flight = null;
    shake = null;
  }

  /**
   * The core swells, darkens and trembles; the comets tighten into a spiral
   * and fall in behind it. It keeps trembling until it is told the answer is
   * in, however long the source takes.
   */
  function collapse(swarmEl: SVGGElement, heartEl: SVGGElement) {
    still();
    const orbiting = Number(gsap.getProperty(swarmEl, "scale")) > 0.05;
    shake = gsap.to(heartEl, {
      x: "random(-0.4, 0.4)",
      y: "random(-0.4, 0.4)",
      duration: 0.045,
      ease: "none",
      repeat: -1,
      repeatRefresh: true,
    });
    const tl = gsap.timeline();
    tl.to(heartEl, { scale: 1.45, duration: 0.5, ease: "power2.out" }, 0);
    /* The pull starts gentle and ends violent: the comets hold most of their
       orbit for the first half, then the spiral tightens and quickens. */
    if (orbiting)
      tl.to(swarmEl, { scale: 0, duration: SPIRAL, ease: "power2.in" }, 0)
        .to(
          swarmEl,
          { rotation: "-=1080", duration: SPIRAL, ease: "power3.in" },
          0,
        )
        .set(swarmEl, { opacity: 0 }, ENTER);
    return tl;
  }

  $effect(() => {
    const m = mode;
    if (!svg || !swarm || !heart || !halo || reducedMotion()) return;
    const hot = m === "seek";
    if (loops && (hot || loops.timeScale() > 1))
      gsap.to(loops, {
        timeScale: hot ? 2.4 : 1,
        duration: hot ? 0.6 : 1.8,
        ease: "power2.inOut",
        overwrite: true,
      });
    gsap.to(svg, {
      "--heat": hot ? 1 : 0,
      duration: hot ? 0.5 : 2.4,
      ease: "sine.inOut",
      overwrite: "auto",
    });
    gsap.to(halo, {
      autoAlpha: m === "idle" ? 1 : 0,
      duration: 0.5,
      overwrite: true,
    });
    if (m === "seek") flight = collapse(swarm, heart);
    else if (m === "gone") {
      still();
      const el = kick;
      if (el)
        gsap.to(el, {
          scale: 0,
          rotation: -90,
          duration: 0.35,
          ease: "back.in(1.6)",
          overwrite: true,
          onComplete: () => {
            gsap.set(el, { autoAlpha: 0 });
            loops?.pause();
          },
        });
    } else {
      still();
      loops?.resume();
      if (kick)
        gsap.to(kick, { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.4 });
      gsap.to(heart, { scale: 1, x: 0, y: 0, duration: 0.4 });
      gsap.to(swarm, {
        scale: 1,
        opacity: 1,
        duration: 0.9,
        ease: "back.out(1.4)",
      });
    }
  });

  /** How long an ask should be held for the collapse to land, in ms. */
  export function holdFor(): number {
    if (!swarm || reducedMotion()) return 0;
    const orbiting = Number(gsap.getProperty(swarm, "scale")) > 0.05;
    return ((orbiting ? ENTER : 0) + AFTER) * 1000;
  }

  /** Where the letters leave from, in viewport pixels. */
  export function centre(): Point | null {
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** Folds back into its core, for leaving. */
  export function vanish(): Promise<void> {
    const el = kick;
    if (!el || reducedMotion()) return Promise.resolve();
    return new Promise((done) =>
      gsap.to(el, {
        scale: 0,
        rotation: -140,
        opacity: 0,
        duration: 0.45,
        ease: "power2.in",
        overwrite: true,
        onComplete: () => done(),
      }),
    );
  }

  onDestroy(() => {
    still();
    if (svg) gsap.killTweensOf(svg);
    if (kick) gsap.killTweensOf(kick);
  });
</script>

<svg
  bind:this={svg}
  class="orbit"
  viewBox="{-PAD} {-PAD} {GRID + 2 * PAD} {GRID + 2 * PAD}"
  fill="none"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <defs>
    <linearGradient
      id="{uid}-core"
      bind:this={coreGrad}
      gradientUnits="userSpaceOnUse"
      x1={C - Number(core.r)}
      y1={C}
      x2={C + Number(core.r)}
      y2={C}
    >
      <stop offset="0" class="s-a" />
      <stop offset="0.5" class="s-c" />
      <stop offset="1" class="s-b" />
    </linearGradient>
    {#each ends as e, i (i)}
      {@const { head, tail } = COMETS[i % COMETS.length]}
      <linearGradient
        id="{uid}-tail-{i}"
        gradientUnits="userSpaceOnUse"
        x1={e.from.x}
        y1={e.from.y}
        x2={e.to.x}
        y2={e.to.y}
      >
        <stop offset="0" class="s-{tail}" stop-opacity="0" />
        <stop offset="0.55" class="s-{tail}" stop-opacity="0.55" />
        <stop offset="1" class="s-{head}" />
      </linearGradient>
    {/each}
  </defs>

  <g bind:this={kick}>
    <g bind:this={halo}>
      <circle bind:this={ring} class="ring" cx={C} cy={C} r={RING} />
    </g>
    <!-- Drawn before the core, so what spirals in goes behind it. -->
    <g bind:this={swarm}>
      {#each tails as t, i (i)}
        {@const moon = moons[heads[i]]}
        <g bind:this={cometEls[i]}>
          <path
            bind:this={tailEls[i]}
            {...t}
            stroke={ends[i] ? `url(#${uid}-tail-${i})` : "currentColor"}
            stroke-width="1.15"
          />
          {#if moon}
            {@const k = COMETS[i % COMETS.length].moon}
            {@const tip = ends[i]?.to ?? {
              x: Number(moon.cx),
              y: Number(moon.cy),
            }}
            <!-- Shrunk toward the tail's end rather than its own centre, so
                 the head still sits on the tail. -->
            <circle
              cx={tip.x + (Number(moon.cx) - tip.x) * k}
              cy={tip.y + (Number(moon.cy) - tip.y) * k}
              r={Number(moon.r) * k}
              class="moon m-{COMETS[i % COMETS.length].head}"
              stroke-width="1.15"
            />
          {/if}
        </g>
      {/each}
    </g>
    <g bind:this={heart}>
      <circle
        bind:this={voidEl}
        class="void"
        cx={core.cx}
        cy={core.cy}
        r={Number(core.r)}
      />
      <circle
        bind:this={coreEl}
        {...core}
        stroke="url(#{uid}-core)"
        fill="url(#{uid}-core)"
        fill-opacity="0.12"
        stroke-width="1.3"
      />
    </g>
  </g>
</svg>

<style>
  /* Four quiet colours that only come fully alive while it is asking: at rest
     each is mixed a third of the way back to the muted grey. */
  .orbit {
    --heat: 0;
    --orb-a: #d29b58;
    --orb-b: #8f86d9;
    --orb-c: #4faaa0;
    --orb-d: #c5738f;
    --sat: calc(62% + var(--heat) * 38%);
    width: 10.5rem;
    height: 10.5rem;
    overflow: visible;
    color: var(--muted);
  }
  .s-a {
    stop-color: color-mix(in oklch, var(--orb-a) var(--sat), var(--muted));
  }
  .s-b {
    stop-color: color-mix(in oklch, var(--orb-b) var(--sat), var(--muted));
  }
  .s-c {
    stop-color: color-mix(in oklch, var(--orb-c) var(--sat), var(--muted));
  }
  .s-d {
    stop-color: color-mix(in oklch, var(--orb-d) var(--sat), var(--muted));
  }

  .moon {
    fill-opacity: 0.22;
  }
  .m-a {
    stroke: color-mix(in oklch, var(--orb-a) var(--sat), var(--muted));
    fill: color-mix(in oklch, var(--orb-a) var(--sat), var(--muted));
  }
  .m-c {
    stroke: color-mix(in oklch, var(--orb-c) var(--sat), var(--muted));
    fill: color-mix(in oklch, var(--orb-c) var(--sat), var(--muted));
  }

  /* The hole the comets fall into: opaque, so what passes behind it is gone. */
  .void {
    fill: #07070a;
  }

  .ring {
    stroke: var(--muted);
    stroke-width: 0.35;
    stroke-dasharray: 0.4 1.6;
    opacity: calc(0.28 + var(--heat) * 0.25);
  }
</style>
