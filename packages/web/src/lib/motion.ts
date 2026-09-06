import { gsap, SplitText, reducedMotion } from "./gsap";

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
 * Resolves a mask of password dots into plain text — in the placeholder if the
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

/** Fills a gauge upwards to `pct` (0-100), staggered by list position. */
export function growBar(node: HTMLElement, p: { pct: number; delay?: number }) {
  const set = (v: number) => {
    node.style.height = `${v}%`;
  };
  if (reducedMotion()) {
    set(p.pct);
    return { update: (n: typeof p) => set(n.pct) };
  }
  gsap.fromTo(
    node,
    { height: "0%" },
    {
      height: `${p.pct}%`,
      duration: 0.8,
      delay: p.delay ?? 0,
      ease: "power2.out",
    },
  );
  return {
    update: (n: typeof p) =>
      gsap.to(node, { height: `${n.pct}%`, duration: 0.4, ease: "power2.out" }),
    destroy: () => gsap.killTweensOf(node),
  };
}

/** Reads --accent live, so the pulse follows the accent picker. */
export function glow(node: Element) {
  if (reducedMotion()) return null;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  return gsap.fromTo(
    node,
    { filter: `drop-shadow(0 0 0px ${accent})` },
    {
      filter: `drop-shadow(0 0 5px ${accent}) drop-shadow(0 0 9px ${accent})`,
      duration: 1.6,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
    },
  );
}

export function clearGlow(node: Element) {
  gsap.set(node, { filter: "none" });
}

/**
 * Half-period of the grow/shrink pulse: the icon is at its biggest at PULSE,
 * 3·PULSE, 5·PULSE… Anything that wants to land on a peak — the thread's bead —
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
 * One discharge into a node — the far end of an arriving thread.
 *
 * drop-shadow, not box-shadow: box-shadow traces the element's border box, so
 * on a node whose visible shape is drawn rather than boxed — the artifact tab
 * is a hexagon on a borderless button — it flashes a rectangle around it.
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

/** Horizontal clip-path wipe, staggered — the nav reveal. */
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
