/**
 * Positions a popup against its anchor in viewport coordinates, so a dialog's
 * scrolling body cannot crop it.
 *
 * `position: fixed` rather than a portal: nothing is reparented, so Svelte
 * keeps ownership of the node and the popup stays inside the stacking context
 * it was written in. The one thing it asks in return is that no ancestor
 * carries a transform, filter or `contain` - any of those makes itself the
 * containing block and fixed goes back to being absolute. That is why the
 * dialog's open tween clears its own transform when it lands.
 */

export type Placement =
  "below-start" | "below-end" | "above-start" | "above-end" | "beside";

export type FloatOptions = {
  anchor: HTMLElement | undefined;
  /** Preferred side and edge to line up. Flips when the side has no room. */
  placement?: Placement;
  /** Distance from the anchor, in px. */
  gap?: number;
  /** At least as wide as the anchor. */
  matchWidth?: boolean;
};

/** Air kept between the popup and the edge of the screen. */
const MARGIN = 8;
/** Below this a flipped popup is no better than a cropped one. */
const FLOOR = 96;

/**
 * The nearest ancestor that masks its content. Fixed positioning escapes
 * overflow, but not a mask: the app window is drawn with one, and a popup
 * placed past its edge by viewport arithmetic alone was cut in half.
 */
function maskingAncestor(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const cs = getComputedStyle(el);
    const mask = cs.maskImage || cs.getPropertyValue("-webkit-mask-image");
    if (mask && mask !== "none") return el;
  }
  return null;
}

export function float(node: HTMLElement, options: FloatOptions) {
  let opts = options;
  const clip = maskingAncestor(node);

  function place() {
    const anchor = opts.anchor;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const gap = opts.gap ?? 2;
    const placement = opts.placement ?? "below-start";
    const c = clip?.getBoundingClientRect();
    const top = Math.max(0, c?.top ?? 0);
    const left = Math.max(0, c?.left ?? 0);
    const vh = Math.min(
      document.documentElement.clientHeight,
      c?.bottom ?? Infinity,
    );
    const vw = Math.min(
      document.documentElement.clientWidth,
      c?.right ?? Infinity,
    );

    if (opts.matchWidth) node.style.minWidth = `${a.width}px`;

    if (placement === "beside" && besides(a, vw, left, top, vh, gap)) return;

    /* Measured with the cap off, so "how tall does it want to be" is the
       content's answer and not the last frame's. The border box is what the
       cap is then set against - `scrollHeight` stops at the padding box, so
       capping with it left every bordered popup two pixels short of its own
       content and permanently scrolling.

       Taking the cap off also makes the popup's own scrollers briefly
       non-overflowing, and the browser clamps their scrollTop to 0 on the way
       past - so what the user had scrolled to is put back once it is on. */
    const scrolled: [Element, number][] = [];
    for (const el of node.querySelectorAll("*"))
      if (el.scrollTop) scrolled.push([el, el.scrollTop]);

    node.style.maxHeight = "";
    const wants = Math.ceil(node.getBoundingClientRect().height);

    const below = vh - a.bottom - gap - MARGIN;
    const above = a.top - top - gap - MARGIN;
    let up = placement.startsWith("above");
    if (up && wants > above && below > above) up = false;
    else if (!up && wants > below && above > below) up = true;

    const room = up ? above : below;
    node.style.maxHeight = `${Math.min(wants, Math.max(room, FLOOR))}px`;
    for (const [el, top] of scrolled) el.scrollTop = top;

    const h = node.offsetHeight;
    const w = node.offsetWidth;
    const y = up ? a.top - gap - h : a.bottom + gap;
    const x = placement.endsWith("end") ? a.right - w : a.left;

    node.style.top = `${clamp(y, top + MARGIN, vh - h - MARGIN)}px`;
    node.style.left = `${clamp(x, left + MARGIN, vw - w - MARGIN)}px`;
  }

  /**
   * To the right of the anchor, top edges level, else to its left; for a list
   * that must not cover what sits under its trigger. False when neither side
   * has room, and the caller falls back to below.
   */
  function besides(
    a: DOMRect,
    vw: number,
    left: number,
    top: number,
    vh: number,
    gap: number,
  ) {
    node.style.maxHeight = `${vh - top - 2 * MARGIN}px`;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const x =
      a.right + gap + w <= vw - MARGIN
        ? a.right + gap
        : a.left - gap - w >= left + MARGIN
          ? a.left - gap - w
          : null;
    if (x === null) return false;
    node.style.left = `${x}px`;
    node.style.top = `${clamp(a.top, top + MARGIN, vh - h - MARGIN)}px`;
    return true;
  }

  node.style.position = "fixed";
  node.style.top = "0";
  node.style.left = "0";
  place();

  /* Capture, so an ancestor scrolling under the popup moves it too - the
     bubbling phase never sees a scroll on anything but the document. The
     popup's own list is the exception: it has not moved, and re-placing on it
     re-measures, which is the one thing that disturbs the scroll being made. */
  const onScroll = (e: Event) => {
    if (node.contains(e.target as Node)) return;
    place();
  };
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  const ro = new ResizeObserver(place);
  ro.observe(node);
  if (opts.anchor) ro.observe(opts.anchor);

  return {
    update(next: FloatOptions) {
      opts = next;
      place();
    },
    destroy() {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      ro.disconnect();
    },
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(v, Math.max(lo, hi)));
