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
