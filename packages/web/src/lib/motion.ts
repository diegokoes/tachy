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

/** Counts [data-val] nodes up from zero; falls back to the final text. */
export function countUp(root: HTMLElement) {
  const nodes = root.querySelectorAll<HTMLElement>("[data-val]");
  if (reducedMotion()) {
    for (const el of nodes) el.textContent = el.dataset.final ?? "";
    return;
  }
  nodes.forEach((el, i) => {
    const target = Number(el.dataset.val ?? 0);
    const suffix = el.dataset.suffix ?? "";
    const obj = { val: 0 };
    gsap.to(obj, {
      val: target,
      duration: 2.6,
      delay: i * 0.08,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = Math.round(obj.val).toLocaleString() + suffix;
      },
    });
  });
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

/** One discharge into a node — the far end of an arriving thread. */
export function jolt(node: Element) {
  if (reducedMotion()) return null;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  return gsap.fromTo(
    node,
    { boxShadow: `0 0 9px 1px ${accent}` },
    {
      boxShadow: `0 0 0px 0px ${accent}`,
      duration: 0.4,
      ease: "power2.out",
      clearProps: "boxShadow",
    },
  );
}

/** Svelte transition: CRT power-on — a scanline that snaps to full height. */
export function crt(_node: Element, { duration = 220 } = {}) {
  if (reducedMotion()) return { duration: 0 };
  return {
    duration,
    easing: (t: number) => 1 - Math.pow(1 - t, 3),
    css: (t: number) =>
      `transform: scaleY(${0.02 + 0.98 * t});` +
      `filter: brightness(${1 + 1.6 * (1 - t)});` +
      `opacity: ${Math.min(1, t * 4)}`,
  };
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
