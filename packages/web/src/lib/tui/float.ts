/**
 * Positions a popup against its anchor in viewport coordinates, so a dialog's
 * scrolling body cannot crop it.
 *
 * `position: fixed` rather than a portal: nothing is reparented, so Svelte
 * keeps ownership of the node and the popup stays inside the stacking context
 * it was written in. The one thing it asks in return is that no ancestor
 * carries a transform, filter or `contain` — any of those makes itself the
 * containing block and fixed goes back to being absolute. That is why the
 * dialog's open tween clears its own transform when it lands.
 */

export type Placement =
  "below-start" | "below-end" | "above-start" | "above-end";

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

export function float(node: HTMLElement, options: FloatOptions) {
  let opts = options;

  function place() {
    const anchor = opts.anchor;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const gap = opts.gap ?? 2;
    const placement = opts.placement ?? "below-start";
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    if (opts.matchWidth) node.style.minWidth = `${a.width}px`;

    /* Measured with the cap off, so "how tall does it want to be" is the
       content's answer and not the last frame's. */
    node.style.maxHeight = "";
    const wants = node.scrollHeight;

    const below = vh - a.bottom - gap - MARGIN;
    const above = a.top - gap - MARGIN;
    let up = placement.startsWith("above");
    if (up && wants > above && below > above) up = false;
    else if (!up && wants > below && above > below) up = true;

    const room = up ? above : below;
    node.style.maxHeight = `${Math.min(wants, Math.max(room, FLOOR))}px`;

    const h = node.offsetHeight;
    const w = node.offsetWidth;
    const y = up ? a.top - gap - h : a.bottom + gap;
    const x = placement.endsWith("end") ? a.right - w : a.left;

    node.style.top = `${clamp(y, MARGIN, vh - h - MARGIN)}px`;
    node.style.left = `${clamp(x, MARGIN, vw - w - MARGIN)}px`;
  }

  node.style.position = "fixed";
  node.style.top = "0";
  node.style.left = "0";
  place();

  /* Capture, so an ancestor scrolling under the popup moves it too — the
     bubbling phase never sees a scroll on anything but the document. */
  const onScroll = () => place();
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
