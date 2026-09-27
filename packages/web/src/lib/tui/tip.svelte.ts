/**
 * The visible name of a control that shows only a mark: up on pointer hover,
 * on keyboard focus and on a tap, down on Escape. A native `title` covers
 * the first of those alone, and only after the browser's own delay.
 *
 * The control keeps its aria-label; the tip repeats it for the eye and stays
 * out of the accessibility tree. One tip is up at a time, drawn by TipHost.
 */

/** Pointer hover waits this long, so a sweep across a toolbar stays quiet. */
export const HOVER_DELAY = 300;
/** Time to cross from the control onto the tip before it goes. */
export const GRACE = 120;
/** How long a tapped tip stays up once the finger lifts. */
export const TOUCH_LINGER = 1500;

export const tipState = $state<{ anchor: HTMLElement | null; text: string }>({
  anchor: null,
  text: "",
});

let hideTimer: ReturnType<typeof setTimeout> | undefined;

function showTip(anchor: HTMLElement, text: string) {
  clearTimeout(hideTimer);
  tipState.anchor = anchor;
  tipState.text = text;
}

function hideTip(anchor: HTMLElement, after = 0) {
  if (tipState.anchor !== anchor) return;
  clearTimeout(hideTimer);
  const drop = () => {
    if (tipState.anchor === anchor) tipState.anchor = null;
  };
  if (after) hideTimer = setTimeout(drop, after);
  else drop();
}

/** The pointer is on the tip itself, so it stays up to be read. */
export const holdTip = () => clearTimeout(hideTimer);

export const releaseTip = () => {
  if (tipState.anchor) hideTip(tipState.anchor, GRACE);
};

export const dismissTip = () => {
  clearTimeout(hideTimer);
  tipState.anchor = null;
};

export function tip(node: HTMLElement, text: string | undefined) {
  let label = text;
  let hovered = false;
  let focused = false;
  let showTimer: ReturnType<typeof setTimeout> | undefined;

  const settle = (after = 0) => {
    clearTimeout(showTimer);
    if (label && (hovered || focused)) showTip(node, label);
    else hideTip(node, after);
  };

  const enter = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    hovered = true;
    clearTimeout(showTimer);
    if (tipState.anchor) settle();
    else showTimer = setTimeout(settle, HOVER_DELAY);
  };
  const leave = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    hovered = false;
    settle(GRACE);
  };
  const focusIn = (e: FocusEvent) => {
    if (!(e.target as Element).matches(":focus-visible")) return;
    focused = true;
    settle();
  };
  const focusOut = () => {
    if (!focused) return;
    focused = false;
    settle();
  };
  const press = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !label) return;
    showTip(node, label);
  };
  const lift = (e: PointerEvent) => {
    if (e.pointerType === "touch") hideTip(node, TOUCH_LINGER);
  };

  node.addEventListener("pointerenter", enter);
  node.addEventListener("pointerleave", leave);
  node.addEventListener("focusin", focusIn);
  node.addEventListener("focusout", focusOut);
  node.addEventListener("pointerdown", press);
  node.addEventListener("pointerup", lift);
  node.addEventListener("pointercancel", lift);

  return {
    update(next: string | undefined) {
      label = next;
      if (tipState.anchor !== node) return;
      if (label) tipState.text = label;
      else hideTip(node);
    },
    destroy() {
      clearTimeout(showTimer);
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("focusin", focusIn);
      node.removeEventListener("focusout", focusOut);
      node.removeEventListener("pointerdown", press);
      node.removeEventListener("pointerup", lift);
      node.removeEventListener("pointercancel", lift);
      hideTip(node);
    },
  };
}
