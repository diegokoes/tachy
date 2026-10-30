import { gsap, Flip, SplitText, reducedMotion } from "./gsap";

/**
 * Character-shatter: chars fall, tumble and fade, then the block collapses.
 * A Svelte action on a denied approval.
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

/**
 * Resolves a mask of password dots into plain text: the placeholder of an
 * input, the text of anything else. A setting the user has not set still
 * resolves to something, and the decode says that typing or picking here
 * replaces it. An empty string leaves an input's placeholder to the markup and
 * blanks a text node.
 */
export function decode(node: HTMLElement, text: string) {
  const MASK = "•";
  const CHARS = `••••••••••••••••${MASK}`;
  const input = node instanceof HTMLInputElement ? node : null;
  const state = { i: 0 };
  const rand = () => CHARS[Math.floor(Math.random() * CHARS.length)];
  let shown: string | null = null;

  const show = (text: string) => {
    if (input) input.placeholder = text;
    else node.textContent = text;
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
    const length = Math.max(value.length, 10);
    state.i = 0;
    show(MASK.repeat(length));
    gsap.to(state, {
      i: length,
      duration: 1.1,
      ease: "none",
      onUpdate: () => {
        const n = Math.floor(state.i);
        show(
          value.slice(0, n) + Array.from({ length: length - n }, rand).join(""),
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
    const colour = `rgba(${r}, ${g}, ${b}, ${state.t})`;
    gsap.set(node, {
      filter: `drop-shadow(0 0 ${5 * state.t}px ${colour}) drop-shadow(0 0 ${9 * state.t}px ${colour})`,
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
 * One discharge into a node, the far end of an arriving thread. drop-shadow,
 * not box-shadow: box-shadow traces the element's border box, so on a node
 * whose shape is drawn rather than boxed (the artifact tab is a hexagon on a
 * borderless button) it flashes a rectangle around it. drop-shadow follows what
 * is painted.
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

const BELL_PIVOT = "50% 12%";

export function ring(node: Element) {
  if (reducedMotion()) return null;
  // A keyframed tween drops from-values and clearProps.
  gsap.set(node, { transformOrigin: BELL_PIVOT });
  return gsap.to(node, {
    keyframes: {
      rotation: [0, 18, -15, 11, -7, 4, 0],
      easeEach: "sine.inOut",
    },
    duration: 0.7,
    overwrite: true,
    onComplete: () => {
      gsap.set(node, { clearProps: "transform,transformOrigin" });
    },
  });
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
 * gone, for as long as whatever the click opened stays open. drop-shadow for
 * the reason given on `jolt`, with a blur of a pixel or two so the light hugs
 * the outline.
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
  set: (value: number) => void,
  opts: { duration?: number; delay?: number; ease?: string } = {},
) {
  if (reducedMotion()) {
    set(to);
    return null;
  }
  const box = { v: from };
  return gsap.to(box, {
    v: to,
    delay: opts.delay ?? 0,
    duration: opts.duration ?? 0.4,
    ease: opts.ease ?? "power2.out",
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
  opts: { from?: "start" | "end"; delay?: number } = {},
) {
  if (reducedMotion() || !chars.length) return null;
  gsap.killTweensOf(chars);
  gsap.set(chars, { yPercent: 0 });
  return gsap.to(chars, {
    keyframes: { yPercent: [0, -28, 0], easeEach: "sine.inOut" },
    duration: 0.42,
    delay: opts.delay ?? 0,
    stagger: { each: 0.05, from: opts.from ?? "start" },
  });
}

/**
 * A burst of confetti fired upward from the bottom of `container`, arcing out
 * and falling under gravity (Physics2DPlugin). The pieces fly in a fixed layer
 * on the body over the container's box, not inside it: a piece in a scrolling
 * box would grow its scroll height as it falls. The layer goes with the last
 * piece, so the caller owns nothing.
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
  const { left, top, width, height } = container.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;pointer-events:none;z-index:var(--z-overlay);`;
  document.body.appendChild(layer);
  let flying = count;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("span");
    const size = gsap.utils.random(6, 12);
    piece.style.cssText = `position:absolute;top:${height}px;left:${width / 2}px;width:${size}px;height:${size * gsap.utils.random(0.4, 1)}px;background:${colors[i % colors.length]};border-radius:1px;will-change:transform;`;
    layer.appendChild(piece);
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
      onComplete: () => {
        if (--flying === 0) layer.remove();
      },
    });
  }
}

let wipeRun = 0;

/**
 * Swaps the theme behind one wave that crosses the screen. `swap` makes the
 * change. Both pages are snapshots of a view transition, the only way to paint
 * two themes at once; the new one is clipped to a path GSAP rewrites each frame
 * through `--theme-wipe`. The wave rolls sideways as it travels, and its rest
 * line starts and ends one amplitude off screen so no crest shows at either end.
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
  const POINTS = 25;
  const CYCLES = 1.25;
  const run = ++wipeRun;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const start = from === "bottom" ? h : 0;
  const heading = from === "bottom" ? -1 : 1;
  const amplitude = Math.min(48, h * 0.06);
  const restFrom = start - heading * amplitude;
  const restTo = h - start + heading * amplitude;
  const step = w / (POINTS - 1);
  const wave = { progress: 0 };

  const edge = () => {
    const rest = restFrom + (restTo - restFrom) * wave.progress;
    return Array.from(
      { length: POINTS },
      (_, j) =>
        rest +
        amplitude *
          Math.sin(2 * Math.PI * (CYCLES * (j / (POINTS - 1)) + wave.progress)),
    );
  };
  const draw = () => {
    const ys = edge();
    let d = `M 0 ${ys[0]}`;
    for (let j = 0; j < POINTS - 1; j++) {
      const control = (j + 0.5) * step;
      d += ` C ${control} ${ys[j]} ${control} ${ys[j + 1]} ${(j + 1) * step} ${ys[j + 1]}`;
    }
    root.style.setProperty("--theme-wipe", `path("${d} V ${start} H 0 Z")`);
  };

  const tween = gsap.to(wave, {
    progress: 1,
    duration: 0.9,
    ease: "power2.inOut",
    paused: true,
    onUpdate: draw,
  });

  root.dataset.themeWipe = "";
  draw();
  const transition = document.startViewTransition(() => swap());
  const done = () => {
    tween.kill();
    if (run !== wipeRun) return;
    delete root.dataset.themeWipe;
    root.style.removeProperty("--theme-wipe");
  };
  transition.ready.then(() => {
    // A view transition ends when its pseudo-elements stop animating, and the
    // wipe is not an animation the browser can see. This one changes nothing
    // and keeps the snapshots up for as long as the tween runs.
    root.animate(
      { opacity: [1, 1] },
      {
        duration: tween.duration() * 1000 + 50,
        pseudoElement: "::view-transition-old(root)",
      },
    );
    tween.play();
  }, done);
  transition.finished.then(done, done);
}

/** Horizontal clip-path wipe, staggered. */
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
 * A dialog surface popping out of a blob: a circle at the window's centre
 * grows, swells past the window's size while its corners square off, and
 * settles into the rounded rectangle. Only `plate`, the layer under the
 * contents, is transformed: the contents only fade, so text is never rasterised
 * at a scale and the window never contains its fixed popups.
 */
export function unfold(opts: {
  win: HTMLElement;
  plate: HTMLElement;
  parts: Element[];
  scrim: HTMLElement;
}): Unfolding {
  const { win, plate, parts, scrim } = opts;
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

  // The blob is the plate scaled per axis: at `m` 0 a circle of diameter `d`,
  // at 1 the window, with `k` running its corners between the two. Elliptical
  // radii in lengths: a percentage and a length do not interpolate.
  const blob = { d: 0, m: 1, k: 0 };

  // The border draws only once the window has its shape. Scaled unevenly on the
  // two axes, a hairline changes weight every frame and ripples.
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
    const corner = Math.min(Math.max(blob.k, 0), 1);
    const rx = radius + (w / 2 - radius) * corner;
    const ry = radius + (h / 2 - radius) * corner;
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
      // The frame that first paints the dialog is the expensive one: its
      // layout, and the blur switching on. Started sooner, the timeline counts
      // that frame as elapsed and the first third of the pop is never seen.
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
 * Smooth resizing for a layout change. Call it in the old layout, make the
 * change, then call what it returns: each node travels from its old box to its
 * new one, width and height tweened so text reflows. A zero-basis flex item
 * ignores an inline height, so nodes are absolute for the tween unless
 * `absolute: false`. `onComplete` fires at once when nothing travels.
 */
export function reflow(
  targets: (Element | null | undefined)[],
  opts: {
    duration?: number;
    ease?: string;
    absolute?: boolean;
    onComplete?: () => void;
  } = {},
): () => void {
  const nodes = targets.filter((t): t is Element => Boolean(t));
  if (reducedMotion() || !nodes.length) return () => opts.onComplete?.();
  const state = Flip.getState(nodes);
  const duration = opts.duration ?? 0.35;
  return () => {
    Flip.from(state, {
      duration,
      ease: opts.ease ?? "power2.inOut",
      absolute: opts.absolute ?? true,
      onComplete: opts.onComplete,
      onEnter: (els) =>
        gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration }),
      onLeave: (els) => gsap.to(els, { opacity: 0, duration: duration / 2 }),
    });
  };
}

/**
 * Takes `tile` to the size of the window, or back: the live node resizes
 * between its two boxes, so its chart redraws at each size on the way. `swap`
 * changes the layout and returns when the DOM shows it. While the tile travels
 * out of flow, `data-morphing` lets it clip what does not fit yet and an empty
 * copy holds its place, so its neighbours stay put.
 */
export async function morphTile(
  tile: HTMLElement | null | undefined,
  swap: () => void | Promise<void>,
) {
  let slot: HTMLElement | undefined;
  if (tile) tile.dataset.morphing = "";
  const play = reflow([tile], {
    duration: 0.5,
    ease: "expo.out",
    onComplete: () => {
      slot?.remove();
      if (tile) delete tile.dataset.morphing;
    },
  });
  await swap();
  if (tile) slot = holdPlace(tile);
  play();
}

/** Puts an empty node that lays out like `node` right after it. */
function holdPlace(node: HTMLElement): HTMLElement {
  const slot = document.createElement(node.tagName);
  slot.className = node.className;
  slot.style.cssText = node.style.cssText;
  slot.setAttribute("aria-hidden", "true");
  node.after(slot);
  return slot;
}

/**
 * Small marks along each rail that drift left without end, one step of the
 * pattern at a time, so a board at rest still shows time going by. The marks
 * are a repeating pattern `step` px wide, so the loop has no seam. Returns
 * what stops it.
 */
export function driftMarks(rails: Element[], step: number): () => void {
  if (reducedMotion() || !rails.length) return () => {};
  const tweens = rails.map((rail) =>
    gsap.fromTo(
      rail,
      { x: 0 },
      { x: -step, duration: step / 3.5, ease: "none", repeat: -1 },
    ),
  );
  return () => {
    tweens.forEach((t) => t.kill());
    gsap.set(rails, { clearProps: "transform" });
  };
}

/** A tick that breathes: a long, shallow swell in width and light. Returns what stops it. */
export function breathe(ticks: Element[]): () => void {
  if (reducedMotion() || !ticks.length) return () => {};
  const tweens = ticks.map((tick, i) =>
    gsap.to(tick, {
      scaleX: 1.9,
      opacity: 0.6,
      duration: 1.7,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
      delay: i * 0.25,
      transformOrigin: "50% 50%",
    }),
  );
  return () => {
    tweens.forEach((t) => t.kill());
    gsap.set(ticks, { clearProps: "transform,opacity" });
  };
}

/**
 * Brings one lane forward: its ticks rise a little on a soft overshoot and
 * every other lane steps back. `null` lets them all settle.
 */
export function focusLane(
  lanes: Element[],
  active: Element | null,
  ticksOf: (lane: Element) => Element[],
) {
  if (reducedMotion()) return;
  for (const lane of lanes) {
    const on = lane === active;
    gsap.to(lane, {
      opacity: active && !on ? 0.4 : 1,
      duration: 0.3,
      ease: "power2.out",
      overwrite: "auto",
    });
    gsap.to(ticksOf(lane), {
      scaleY: on ? 1.4 : 1,
      duration: on ? 0.35 : 0.25,
      ease: on ? "back.out(2)" : "power2.out",
      overwrite: "auto",
    });
  }
}
