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
 * placed past its edge by viewport arithmetic alone is cut in half.
 */
function maskingAncestor(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const computed = getComputedStyle(el);
    const mask =
      computed.maskImage || computed.getPropertyValue("-webkit-mask-image");
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
    const anchorRect = anchor.getBoundingClientRect();
    const gap = opts.gap ?? 2;
    const placement = opts.placement ?? "below-start";
    const clipRect = clip?.getBoundingClientRect();
    const top = Math.max(0, clipRect?.top ?? 0);
    const left = Math.max(0, clipRect?.left ?? 0);
    const vh = Math.min(
      document.documentElement.clientHeight,
      clipRect?.bottom ?? Infinity,
    );
    const vw = Math.min(
      document.documentElement.clientWidth,
      clipRect?.right ?? Infinity,
    );

    if (opts.matchWidth) node.style.minWidth = `${anchorRect.width}px`;

    if (placement === "beside" && besides(anchorRect, vw, left, top, vh, gap))
      return;

    // Measured with the cap off, so the content says how tall it wants to be.
    // The cap is set against the border box, as `scrollHeight` stops at the
    // padding box. Scroll positions the uncapping clamps to 0 are put back.
    const scrolled: [Element, number][] = [];
    for (const el of node.querySelectorAll("*"))
      if (el.scrollTop) scrolled.push([el, el.scrollTop]);

    node.style.maxHeight = "";
    const wants = Math.ceil(node.getBoundingClientRect().height);

    const below = vh - anchorRect.bottom - gap - MARGIN;
    const above = anchorRect.top - top - gap - MARGIN;
    let up = placement.startsWith("above");
    if (up && wants > above && below > above) up = false;
    else if (!up && wants > below && above > below) up = true;

    const room = up ? above : below;
    node.style.maxHeight = `${Math.min(wants, Math.max(room, FLOOR))}px`;
    for (const [el, top] of scrolled) el.scrollTop = top;

    const h = node.offsetHeight;
    const w = node.offsetWidth;
    const y = up ? anchorRect.top - gap - h : anchorRect.bottom + gap;
    const x = placement.endsWith("end")
      ? anchorRect.right - w
      : anchorRect.left;

    node.style.top = `${clamp(y, top + MARGIN, vh - h - MARGIN)}px`;
    node.style.left = `${clamp(x, left + MARGIN, vw - w - MARGIN)}px`;
  }

  /**
   * To the right of the anchor, top edges level, else to its left; for a list
   * that must not cover what sits under its trigger. False when neither side
   * has room, and the caller falls back to below.
   */
  function besides(
    anchorRect: DOMRect,
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
      anchorRect.right + gap + w <= vw - MARGIN
        ? anchorRect.right + gap
        : anchorRect.left - gap - w >= left + MARGIN
          ? anchorRect.left - gap - w
          : null;
    if (x === null) return false;
    node.style.left = `${x}px`;
    node.style.top = `${clamp(anchorRect.top, top + MARGIN, vh - h - MARGIN)}px`;
    return true;
  }

  node.style.position = "fixed";
  node.style.top = "0";
  node.style.left = "0";
  place();

  // Capture, so an ancestor scrolling under the popup moves it too: bubbling
  // only sees a scroll on the document. The popup's own list is skipped, since
  // re-placing re-measures and disturbs the scroll being made.
  const onScroll = (e: Event) => {
    if (node.contains(e.target as Node)) return;
    place();
  };
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  const observer = new ResizeObserver(place);
  observer.observe(node);
  if (opts.anchor) observer.observe(opts.anchor);

  return {
    update(next: FloatOptions) {
      opts = next;
      place();
    },
    destroy() {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      observer.disconnect();
    },
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(v, Math.max(lo, hi)));
