import { scrollport } from "../shell/scrollport.svelte";

/**
 * The open dialogs, innermost last. Escape and Enter reach the topmost one
 * only, and only the topmost one is in view: a dialog it covers folds away, or,
 * where it asks, stays and sinks into the blur with the app.
 */
type Layer = {
  id: symbol;
  /** Whatever this layer covers stays in view, blurred, whatever it asked. */
  sinkBelow: boolean;
};

const stack = $state<Layer[]>([]);

// One lock for the whole stack, taken by the first dialog and handed back by
// the last. Both boxes: the view scrolls inside `main`, so locking the body
// alone leaves the page running under the dialog.
let unlock: (() => void) | null = null;

export function enterDialog(id: symbol, { sinkBelow = false } = {}) {
  if (!stack.length) {
    const port = scrollport();
    const body = document.body.style.overflow;
    const ported = port?.style.overflow ?? "";
    document.body.style.overflow = "hidden";
    if (port) port.style.overflow = "hidden";
    document.documentElement.toggleAttribute("data-dialog", true);
    unlock = () => {
      document.body.style.overflow = body;
      if (port) port.style.overflow = ported;
      document.documentElement.toggleAttribute("data-dialog", false);
    };
  }
  stack.push({ id, sinkBelow });
}

export function leaveDialog(id: symbol) {
  const i = stack.findIndex((layer) => layer.id === id);
  if (i < 0) return;
  stack.splice(i, 1);
  if (!stack.length) {
    unlock?.();
    unlock = null;
  }
}

export const isTopDialog = (id: symbol) => stack.at(-1)?.id === id;

export const isCovered = (id: symbol) =>
  !isTopDialog(id) && stack.some((layer) => layer.id === id);

/** How a covered dialog gets out of the way: as it asked, unless the top layer needs it kept. */
export function coverMode(own: "hide" | "blur"): "hide" | "blur" {
  return stack.at(-1)?.sinkBelow ? "blur" : own;
}
