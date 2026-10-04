import { gsap, Flip, SplitText, reducedMotion } from "./gsap";

/**
 * Character-shatter: chars fall, tumble and fade, then the block collapses.
 * Used as a Svelte action on a denied approval and, via `shatterAll`, by the
 * chat Clear ceremony.
 */
export function shatter(node: HTMLElement) {
  if (reducedMotion()) return;
  const split = new SplitText(node, { type: "chars", reduceWhiteSpace: false });
  const tl = gsap.timeline({
    onComplete: () => {
      split.revert();
      node.style.visibility = "hidden";
    },
  });
  tl.to(split.chars, {
    y: () => gsap.utils.random(60, 200),
    rotation: () => gsap.utils.random(-30, 30),
    opacity: 0,
    duration: 0.6,
    ease: "power1.in",
    stagger: { amount: 0.45 },
  });
  tl.to(node, { height: 0, marginTop: 0, duration: 0.3 }, "-=0.15");
  return {
    destroy: () => {
      tl.kill();
      split.revert();
    },
  };
}

export function shatterAll(nodes: HTMLElement[], onComplete: () => void) {
  if (reducedMotion() || !nodes.length) {
    onComplete();
    return null;
  }
  const split = new SplitText(nodes, {
    type: "chars",
    reduceWhiteSpace: false,
  });
  const tl = gsap.timeline({
    onComplete: () => {
      split.revert();
      onComplete();
    },
  });
  tl.to(split.chars, {
    y: () => gsap.utils.random(60, 200),
    rotation: () => gsap.utils.random(-30, 30),
    opacity: 0,
    duration: 0.6,
    ease: "power1.in",
    stagger: { amount: 0.5 },
  });
  tl.to(nodes, { y: 40, opacity: 0, duration: 0.4 }, 0.25);
  return tl;
}

/**
 * Resolves a mask of password dots into plain text - in the placeholder if the
 * node is an input, in its text otherwise. A setting the user has not set
 * themselves still resolves to something; the decode is what says so, and says
 * that typing or picking here replaces it.
 *
 * An empty string leaves an input's placeholder to the markup, and blanks a
 * text node.
 */
export function decode(node: HTMLElement, text: string) {
  const MASK = "•";
  const CHARS = `••••••••••••••••${MASK}`;
  const input = node instanceof HTMLInputElement ? node : null;
  const state = { i: 0 };
  const rand = () => CHARS[Math.floor(Math.random() * CHARS.length)];
  let shown: string | null = null;

  const show = (s: string) => {
    if (input) input.placeholder = s;
    else node.textContent = s;
  };

  const run = (value: string) => {
    if (value === shown) return;
    shown = value;
    gsap.killTweensOf(state);
    if (!value) {
      if (!input) node.textContent = "";
      return;
    }
    if (reducedMotion()) {
      show(value);
      return;
    }
    const len = Math.max(value.length, 10);
    state.i = 0;
    show(MASK.repeat(len));
    gsap.to(state, {
      i: len,
      duration: 1.1,
      ease: "none",
      onUpdate: () => {
        const n = Math.floor(state.i);
        show(
          value.slice(0, n) + Array.from({ length: len - n }, rand).join(""),
        );
      },
      onComplete: () => show(value),
    });
  };

  run(text);
  return { update: run, destroy: () => gsap.killTweensOf(state) };
}

/**
 * Reads --accent live, so the pulse follows the accent picker.
 *
 * The shadow's alpha falls with its blur. A drop-shadow at 0px blur and full
 * alpha is a hard silhouette of the node, so tweening only the blur flashed a
 * sharp copy at the bottom of every cycle.
 */
export function glow(node: Element) {
  if (reducedMotion()) return null;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  const [r, g, b] = gsap.utils.splitColor(accent) as number[];
  const state = { t: 0 };
  const paint = () => {
    const c = `rgba(${r}, ${g}, ${b}, ${state.t})`;
    gsap.set(node, {
      filter: `drop-shadow(0 0 ${5 * state.t}px ${c}) drop-shadow(0 0 ${9 * state.t}px ${c})`,
    });
  };
  paint();
  return gsap.to(state, {
    t: 1,
    duration: 1.6,
    yoyo: true,
    repeat: -1,
    ease: "sine.inOut",
    onUpdate: paint,
  });
}

export function clearGlow(node: Element) {
  gsap.set(node, { filter: "none" });
}

/**
 * A few soft text-shadow pulses in the node's own colour, ending unlit. For a
 * tag that opens something and has to say so once, not keep saying it.
 * `loop` keeps it going until the node goes, for something still under way.
 */
export function shadowPulse(node: HTMLElement, opts?: { loop?: boolean }) {
  if (reducedMotion()) return;
  const color = getComputedStyle(node).color;
  const tween = gsap.fromTo(
    node,
    {
      textShadow: opts?.loop
        ? `0 0 0px ${color}, 0 0 0px ${color}`
        : `0 0 0px ${color}`,
    },
    {
      textShadow: opts?.loop
        ? `0 0 8px ${color}, 0 0 14px ${color}`
        : `0 0 6px ${color}`,
      duration: 1.1,
      yoyo: true,
      repeat: opts?.loop ? -1 : 5,
      ease: "sine.inOut",
      clearProps: "textShadow",
    },
  );
  return { destroy: () => void tween.kill() };
}

/**
 * Half-period of the grow/shrink pulse: the icon is at its biggest at PULSE,
 * 3·PULSE, 5·PULSE… Anything that wants to land on a peak - the thread's bead -
 * schedules itself off this, so both must be started in the same frame.
 */
export const PULSE = 0.9;

export function spin(node: Element) {
  if (reducedMotion()) return [];
  gsap.set(node, { rotation: 0, scale: 1 });
  return [
    gsap.to(node, {
      rotation: 360,
      duration: PULSE * 2,
      ease: "none",
      repeat: -1,
    }),
    gsap.to(node, {
      scale: 1.22,
      duration: PULSE,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    }),
  ];
}

export function settle(node: Element) {
  gsap.to(node, { rotation: 0, scale: 1, duration: 0.3, ease: "power2.out" });
}

/**
 * One discharge into a node - the far end of an arriving thread.
 *
 * drop-shadow, not box-shadow: box-shadow traces the element's border box, so
 * on a node whose visible shape is drawn rather than boxed - the artifact tab
 * is a hexagon on a borderless button - it flashes a rectangle around it.
 * drop-shadow follows what is actually painted.
 */
export function jolt(node: Element) {
  if (reducedMotion()) return null;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  return gsap.fromTo(
    node,
    { filter: `drop-shadow(0 0 7px ${accent})` },
    {
      filter: `drop-shadow(0 0 0px ${accent})`,
      duration: 0.4,
      ease: "power2.out",
      clearProps: "filter",
    },
  );
}

/**
 * Squash-and-stretch on click, settling elastic. A press has to feel like it
 * landed on something with give, so the overshoot is the point.
 */
export function jellyPress(node: HTMLElement) {
  const press = () => {
    if (reducedMotion()) return;
    gsap
      .timeline()
      .to(node, { scaleX: 1.18, scaleY: 0.82, duration: 0.1 })
      .to(node, { scaleX: 0.92, scaleY: 1.08, duration: 0.1 })
      .to(node, {
        scaleX: 1,
        scaleY: 1,
        duration: 0.5,
        ease: "elastic.out(1, 0.4)",
      });
  };
  node.addEventListener("click", press);
  return {
    destroy: () => {
      node.removeEventListener("click", press);
      gsap.killTweensOf(node);
    },
  };
}

/**
 * Lifts the node towards the pointer while it hovers, its edge lit in the
 * accent as it goes up. `held` leaves a fainter edge lit once the pointer has
 * gone, for as long as whatever the click opened stays open.
 *
 * drop-shadow, not box-shadow, for the same reason as in `jolt`: a box-shadow
 * would trace the border box of a shape that is drawn rather than boxed. The
 * blur stays at a pixel or two so the light hugs the outline instead of
 * pooling around it.
 */
export function hoverRise(node: HTMLElement, held = false) {
  const [r, g, b] = gsap.utils.splitColor(
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim(),
  );
  const lit = (blur: number, alpha: number) =>
    `drop-shadow(0 0 ${blur}px rgba(${r}, ${g}, ${b}, ${alpha}))`;
  const REST = lit(0, 0);
  const HELD = lit(1, 0.4);
  const RISEN = lit(1.5, 0.75);

  let over = false;
  const shine = (to: string, duration: number) =>
    gsap.to(node, {
      filter: to,
      duration: reducedMotion() ? 0 : duration,
      ease: "sine.out",
      clearProps: to === REST ? "filter" : "",
    });

  const rise = () => {
    over = true;
    if (!reducedMotion())
      gsap.to(node, { y: -8, scale: 1.02, duration: 0.3, overwrite: "auto" });
    shine(RISEN, 0.45);
  };
  const fall = () => {
    over = false;
    gsap.to(node, { y: 0, scale: 1, duration: 0.3, overwrite: "auto" });
    shine(held ? HELD : REST, 0.4);
  };
  node.addEventListener("mouseenter", rise);
  node.addEventListener("mouseleave", fall);
  if (held) shine(HELD, 0);
  return {
    update(now: boolean) {
      if (now === held) return;
      held = now;
      if (!over) shine(held ? HELD : REST, 0.4);
    },
    destroy: () => {
      node.removeEventListener("mouseenter", rise);
      node.removeEventListener("mouseleave", fall);
    },
  };
}

/**
 * Tweens a plain number, for state a component renders from rather than a
 * style GSAP can write directly. Returns the tween so a caller can kill it.
 *
 * Opening overshoots, closing does not: a thing that springs shut reads as a
 * glitch where springing open reads as intent.
 */
export function tweenValue(
  from: number,
  to: number,
  set: (v: number) => void,
  o: { duration?: number; delay?: number; ease?: string } = {},
) {
  if (reducedMotion()) {
    set(to);
    return null;
  }
  const box = { v: from };
  return gsap.to(box, {
    v: to,
    delay: o.delay ?? 0,
    duration: o.duration ?? 0.4,
    ease: o.ease ?? "power2.out",
    onUpdate: () => set(box.v),
  });
}

/**
 * One ripple through a line of split characters: each lifts and settles in
 * turn, the stagger overlapping so the rise travels as a single wave rather than
 * a letter at a time. `from` is the end the wave starts at.
 */
export function ripple(
  chars: Element[],
  o: { from?: "start" | "end"; delay?: number } = {},
) {
  if (reducedMotion() || !chars.length) return null;
  gsap.killTweensOf(chars);
  gsap.set(chars, { yPercent: 0 });
  return gsap.to(chars, {
    keyframes: { yPercent: [0, -28, 0], easeEach: "sine.inOut" },
    duration: 0.42,
    delay: o.delay ?? 0,
    stagger: { each: 0.05, from: o.from ?? "start" },
  });
}

/**
 * A burst of confetti fired upward from the bottom of `container`, arcing out
 * and falling under gravity (Physics2DPlugin). The pieces mount into the
 * container and remove themselves once spent, so the caller owns nothing.
 */
export function confetti(container: HTMLElement, count = 36) {
  if (reducedMotion()) return;
  const colors = [
    "#f43f5e",
    "#f59e0b",
    "#fde047",
    "#22c55e",
    "#38bdf8",
    "#6366f1",
    "#d946ef",
  ];
  const { width, height } = container.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("span");
    const size = gsap.utils.random(6, 12);
    piece.style.cssText = `position:absolute;top:${height}px;left:${width / 2}px;width:${size}px;height:${size * gsap.utils.random(0.4, 1)}px;background:${colors[i % colors.length]};border-radius:1px;pointer-events:none;will-change:transform;`;
    container.appendChild(piece);
    gsap.to(piece, {
      duration: gsap.utils.random(1.4, 2.4),
      physics2D: {
        velocity: gsap.utils.random(350, 650),
        angle: gsap.utils.random(250, 290),
        gravity: 500,
      },
      rotation: gsap.utils.random(-540, 540),
      opacity: 0,
      ease: "none",
      onComplete: () => piece.remove(),
    });
  }
}

let wipeRun = 0;

/**
 * Swaps the theme behind a wavy edge that crosses the screen, two bands of
 * accent running ahead of it. `swap` makes the change; the page as it was
 * stays put and the page as it becomes is uncovered behind the last edge, so
 * text changes colour exactly where the edge passes over it.
 *
 * The two pages are the snapshots of a view transition, which is the only way
 * to have both themes painted at once. The new one is clipped to a path that
 * GSAP rewrites every frame through `--theme-wipe` on the root. The bands sit
 * in a group of their own: left in the root snapshot they would be clipped
 * away with it, since they are always ahead of the edge.
 *
 * Each edge is ten points that leave at slightly different times, the same
 * offsets on all three edges, so the edges ripple but never cross.
 */
export function themeWipe(
  swap: () => void | Promise<void>,
  from: "top" | "bottom" = "bottom",
) {
  const root = document.documentElement;
  if (reducedMotion() || !document.startViewTransition) {
    void swap();
    return;
  }
  const POINTS = 10;
  const EDGES = 3;
  const run = ++wipeRun;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const start = from === "bottom" ? h : 0;
  const step = w / (POINTS - 1);
  const edges = Array.from({ length: EDGES }, () =>
    Array<number>(POINTS).fill(start),
  );
  const last = edges[EDGES - 1];

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.classList.add("theme-wipe");
  const bands = edges.slice(1).map(() => {
    const path = document.createElementNS(NS, "path");
    svg.append(path);
    return path;
  });

  const along = (ys: number[], back = false) => {
    let d = "";
    for (let n = 0; n < POINTS - 1; n++) {
      const j = back ? POINTS - 1 - n : n;
      const k = back ? j - 1 : j + 1;
      const cp = ((j + k) / 2) * step;
      d += ` C ${cp} ${ys[j]} ${cp} ${ys[k]} ${k * step} ${ys[k]}`;
    }
    return d;
  };
  const draw = () => {
    root.style.setProperty(
      "--theme-wipe",
      `path("M 0 ${last[0]}${along(last)} V ${start} H 0 Z")`,
    );
    bands.forEach((path, i) => {
      const lead = edges[i];
      const trail = edges[i + 1];
      path.setAttribute(
        "d",
        `M 0 ${lead[0]}${along(lead)} V ${trail[POINTS - 1]}${along(trail, true)} Z`,
      );
    });
  };

  const tl = gsap.timeline({
    paused: true,
    onUpdate: draw,
    defaults: { ease: "power2.inOut", duration: 0.6 },
  });
  const offsets = last.map(() => Math.random() * 0.2);
  edges.forEach((ys, i) =>
    offsets.forEach((delay, j) =>
      tl.to(ys, { [j]: h - start }, delay + i * 0.12),
    ),
  );

  root.dataset.themeWipe = "";
  draw();
  const transition = document.startViewTransition(async () => {
    await swap();
    document.body.append(svg);
  });
  const done = () => {
    tl.kill();
    svg.remove();
    if (run !== wipeRun) return;
    delete root.dataset.themeWipe;
    root.style.removeProperty("--theme-wipe");
  };
  transition.ready.then(() => {
    /* A view transition ends when its pseudo-elements stop animating, and the
       wipe is not an animation the browser can see. This one changes nothing
       and keeps the snapshots up for as long as the timeline runs. */
    root.animate(
      { opacity: [1, 1] },
      {
        duration: tl.duration() * 1000 + 50,
        pseudoElement: "::view-transition-old(root)",
      },
    );
    tl.play();
  }, done);
  transition.finished.then(done, done);
}

/** Horizontal clip-path wipe, staggered - the nav reveal. */
export function wipeIn(nodes: ArrayLike<Element>, onStart?: () => void) {
  if (reducedMotion()) {
    onStart?.();
    return null;
  }
  return gsap.fromTo(
    nodes,
    { clipPath: "inset(0 100% 0 0)" },
    {
      clipPath: "inset(0 0% 0 0)",
      duration: 0.3,
      ease: "power3.out",
      stagger: 0.09,
      onStart,
      onComplete: () => gsap.set(nodes, { clearProps: "clipPath" }),
    },
  );
}

export type Unfolding = {
  /** Plays the unfold; `onLanded` fires once, when the window is whole. */
  open(onLanded?: () => void): void;
  /** Another dialog opened on top: fold away, or stay and sink into the blur. */
  cover(mode: "hide" | "blur"): void;
  uncover(): void;
  /** Folds the window and fades its scrim. Returns how long that takes, in ms. */
  close(): number;
  kill(): void;
};

/**
 * A dialog surface popping out of a blob: a small circle at the window's
 * centre grows, swells a little past the window's size while its corners
 * square off, and settles into the rounded rectangle; the contents fade up
 * once the corners are there to hold them. Closing and covering pull the
 * window back into a circle and shrink that to nothing.
 *
 * Only `plate`, the surface layer under the window's contents, is transformed.
 * The contents only fade, so their text is never rasterised at a scale and
 * never snaps sharp on landing, and the window never becomes the containing
 * block for the `position: fixed` popups inside it. The scrim is tweened on its
 * own, so a covered dialog hands its ink to the one on top even while its
 * window stays in view.
 */
export function unfold(o: {
  win: HTMLElement;
  plate: HTMLElement;
  parts: Element[];
  scrim: HTMLElement;
}): Unfolding {
  const { win, plate, parts, scrim } = o;
  const still = reducedMotion();
  const BACK = 1.6;
  const radius = parseFloat(getComputedStyle(plate).borderTopLeftRadius) || 0;
  const blur = getComputedStyle(document.documentElement)
    .getPropertyValue("--scrim-blur")
    .trim();
  let landed: (() => void) | undefined;
  let state: "open" | "hidden" | "sunk" = "open";
  let queued = 0;
  let tl: gsap.core.Timeline | undefined;

  /* The blob is the plate at its own size, scaled on each axis. At `m` 0 it is
     a circle of diameter `d`, at 1 the window; `k` runs its corners from an
     ellipse of the window's proportions, which that scale turns into the
     circle, to the window's radius. Explicit elliptical radii rather than
     "50%": a percentage and a length do not interpolate into one another. */
  const blob = { d: 0, m: 1, k: 0 };

  /* The border draws only once the window has its shape. Scaled unevenly on
     the two axes, a hairline changes weight every frame and ripples. */
  const line = getComputedStyle(plate).borderTopColor;
  const clear = /^rgba?\(/.test(line)
    ? line.replace(/^rgba?\(([^,]+,[^,]+,[^,)]+).*$/, "rgba($1, 0)")
    : "transparent";
  const edge = (color: string) => ({
    borderTopColor: color,
    borderRightColor: color,
    borderBottomColor: color,
    borderLeftColor: color,
  });
  let w = 0;
  let h = 0;
  const measure = () => {
    w = plate.offsetWidth;
    h = plate.offsetHeight;
  };
  const draw = () => {
    if (!w || !h) return;
    const sx = (blob.d / w) * (1 - blob.m) + blob.m;
    const sy = (blob.d / h) * (1 - blob.m) + blob.m;
    const k = Math.min(Math.max(blob.k, 0), 1);
    const rx = radius + (w / 2 - radius) * k;
    const ry = radius + (h / 2 - radius) * k;
    plate.style.transform = `scale(${sx}, ${sy})`;
    plate.style.borderRadius = `${rx}px / ${ry}px`;
  };

  const land = () => {
    Object.assign(blob, { d: 0, m: 1, k: 0 });
    plate.style.transform = "";
    plate.style.borderRadius = "";
    gsap.set(plate, {
      clearProps:
        "opacity,borderTopColor,borderRightColor,borderBottomColor,borderLeftColor",
    });
    gsap.set(parts, { clearProps: "opacity" });
    landed?.();
    landed = undefined;
  };

  const fade = (to: number, speed = 1) =>
    gsap.to(scrim, {
      opacity: to,
      duration: still ? 0 : 0.14 / speed,
      ease: "none",
      overwrite: true,
    });

  const forward = () => {
    tl?.kill();
    if (still) return land();
    measure();
    const size = Math.min(w, h);
    tl = gsap
      .timeline({ onUpdate: draw, onComplete: land })
      .to(plate, { opacity: 1, duration: 0.05, ease: "none" }, 0)
      .to(blob, { d: size * 0.5, duration: 0.1, ease: "power1.in" }, 0)
      .to(blob, { m: 1, duration: 0.24, ease: "back.out(1.7)" }, 0.07)
      .to(blob, { k: 0, duration: 0.2, ease: "power2.inOut" }, 0.09)
      .to(parts, { opacity: 1, duration: 0.14, ease: "power1.out" }, 0.15)
      .to(plate, { ...edge(line), duration: 0.1, ease: "none" }, 0.22);
  };

  /** Returns how long the fold takes, in seconds. */
  const backward = () => {
    cancelAnimationFrame(queued);
    tl?.kill();
    if (still) {
      Object.assign(blob, { d: 0, m: 0, k: 1 });
      gsap.set(plate, { opacity: 0 });
      gsap.set(parts, { opacity: 0 });
      return 0;
    }
    measure();
    const size = Math.min(w, h);
    if (blob.m > 0.99) blob.d = size * 0.6;
    tl = gsap
      .timeline({ onUpdate: draw })
      .to(parts, { opacity: 0, duration: 0.07, ease: "power1.out" }, 0)
      .to(plate, { ...edge(clear), duration: 0.04, ease: "none" }, 0)
      .to(blob, { m: 0, k: 1, duration: 0.13, ease: "power2.out" }, 0)
      .to(blob, { d: 0, duration: 0.22, ease: "power2.in" }, 0)
      .to(plate, { opacity: 0, duration: 0.04, ease: "none" }, 0.18);
    return 0.22;
  };

  return {
    open(onLanded) {
      landed = onLanded;
      gsap.set(scrim, { opacity: 0 });
      fade(1);
      if (still) return land();
      measure();
      Object.assign(blob, { d: Math.min(w, h) * 0.08, m: 0, k: 1 });
      gsap.set(plate, { opacity: 0, ...edge(clear) });
      gsap.set(parts, { opacity: 0 });
      draw();
      /* The frame that first paints the dialog is the expensive one: its
         layout, and the blur switching on across the app. Started any
         earlier, the timeline counts that frame as elapsed time and the
         first third of the pop is never seen. */
      queued = requestAnimationFrame(() => {
        queued = requestAnimationFrame(forward);
      });
    },
    cover(mode) {
      if (state !== "open") return;
      fade(0);
      if (mode === "hide") {
        state = "hidden";
        backward();
      } else {
        state = "sunk";
        gsap.to(win, {
          filter: `blur(${blur})`,
          duration: still ? 0 : 0.14,
          overwrite: "auto",
        });
      }
    },
    uncover() {
      if (state === "open") return;
      fade(1);
      if (state === "hidden") forward();
      else
        gsap.to(win, {
          filter: "blur(0px)",
          duration: still ? 0 : 0.14,
          overwrite: "auto",
          clearProps: "filter",
        });
      state = "open";
    },
    close() {
      landed = undefined;
      fade(0, BACK);
      const fold = state === "hidden" ? 0 : backward();
      return still ? 0 : Math.max(fold, 0.14 / BACK) * 1000;
    },
    kill() {
      cancelAnimationFrame(queued);
      tl?.kill();
      gsap.killTweensOf([win, plate, scrim, blob, ...parts]);
    },
  };
}

/**
 * Smooth resizing for a layout change. Call it while the nodes still sit where
 * they were, make the change, then call what it returns once the DOM has the
 * new layout: each node travels from its old box to its new one.
 *
 * Width and height are tweened, not a scale, so text inside a node reflows
 * rather than stretching. A node the change hides (`display: none`) fades out
 * where it stood, and one it reveals fades in.
 *
 * The nodes are positioned absolutely for the length of the tween. A flex item
 * with a zero basis ignores an inline height, so left in flow it would jump to
 * its final size and only its offset would animate.
 *
 * `absolute: false` keeps them in flow, for a node that only changes place:
 * lifted out, its neighbours would take its room and give it back at the end.
 */
export function reflow(
  targets: (Element | null | undefined)[],
  o: { duration?: number; ease?: string; absolute?: boolean } = {},
): () => void {
  const nodes = targets.filter((t): t is Element => Boolean(t));
  if (reducedMotion() || !nodes.length) return () => {};
  const state = Flip.getState(nodes);
  const duration = o.duration ?? 0.35;
  return () => {
    Flip.from(state, {
      duration,
      ease: o.ease ?? "power2.inOut",
      absolute: o.absolute ?? true,
      onEnter: (els) =>
        gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration }),
      onLeave: (els) => gsap.to(els, { opacity: 0, duration: duration / 2 }),
    });
  };
}
