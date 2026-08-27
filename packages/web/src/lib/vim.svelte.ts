import type { Binding } from "./keys.svelte";

/**
 * Vim controls are opt-in because they claim single letters. `j`/`k` on a list
 * are harmless; `h`/`l` moving between sections and `/` swallowing a keystroke
 * are not something to switch on for someone who did not ask for them.
 */
export const vimState = $state({ enabled: false });

export function setVim(on: boolean) {
  vimState.enabled = on;
  localStorage.setItem("tachy-vim", on ? "1" : "0");
}

export function loadVim() {
  vimState.enabled = localStorage.getItem("tachy-vim") === "1";
}

type ListOps = {
  move: (delta: number) => void;
  first: () => void;
  last: () => void;
  open?: () => void;
  search?: () => void;
};

/**
 * The list motions, as one set. Every list in the app registers the same keys
 * against its own cursor rather than each inventing its own subset.
 */
export function listBindings(ops: ListOps): Binding[] {
  if (!vimState.enabled) return [];
  const b: Binding[] = [
    { key: "j", label: "", hidden: true, run: () => ops.move(1) },
    { key: "k", label: "", hidden: true, run: () => ops.move(-1) },
    { key: "g g", label: "", hidden: true, run: ops.first },
    { key: "shift+g", label: "", hidden: true, run: ops.last },
  ];
  if (ops.open) b.push({ key: "⏎", label: "", hidden: true, run: ops.open });
  if (ops.search)
    b.push({ key: "/", label: "", hidden: true, run: ops.search });
  return b;
}

/** Half-page scroll on whichever container the view scrolls in. */
export function scrollBindings(el: () => HTMLElement | undefined): Binding[] {
  if (!vimState.enabled) return [];
  const by = (dir: number) => () => {
    const n = el();
    if (n) n.scrollBy({ top: (n.clientHeight / 2) * dir, behavior: "smooth" });
  };
  return [
    { key: "ctrl+d", label: "", hidden: true, run: by(1) },
    { key: "ctrl+u", label: "", hidden: true, run: by(-1) },
  ];
}
