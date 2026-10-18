import type { KeyRef } from "./bindings.svelte";
import type { Binding } from "./keys.svelte";

/**
 * Vim controls are opt-in because they claim single letters. `j`/`k` on a list
 * are harmless; `h`/`l` moving between sections and `/` swallowing a keystroke
 * are not something to switch on for someone who did not ask for them.
 */
export const vimState = $state({ enabled: false });

/**
 * What vim mode binds, as Settings › keybinds lists it. Real chords, not
 * display strings: they go through the same speller as a rebindable key.
 */
export const VIM_KEYS: KeyRef[] = [
  { keys: ["g g", "shift+g"], what: "first / last row" },
  { keys: ["/"], what: "focus the search box" },
  { keys: ["n", "shift+n"], what: "next / previous match" },
  { keys: ["h", "l"], what: "previous / next section" },
  { keys: ["shift+h", "shift+l"], what: "previous / next sub tab" },
  { keys: ["ctrl+d", "ctrl+u"], what: "scroll half a page" },
];

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
    { key: "ctrl+d", run: by(1) },
    { key: "ctrl+u", run: by(-1) },
  ];
}
