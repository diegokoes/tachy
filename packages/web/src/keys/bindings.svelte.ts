/**
 * User overrides for the two digit key sets, section and subnav. Everything else in the app keeps its fixed binding and is
 * listed read-only in Settings › keybinds.
 *
 * Section keys are stored per nav item, not per slot: navItems() drops `admin`
 * for non-curators, so slot 3 is `admin` for one user and `settings` for the
 * next. Subnav keys are stored per slot, because subnav items differ by section
 * and SHIFT + 1..n is meaningful as a set rather than per destination.
 */

const KEY = "tachy-keys";

type Overrides = {
  nav: Record<string, string>;
  subnav: Record<number, string>;
};

function read(): Overrides {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { nav: raw.nav ?? {}, subnav: raw.subnav ?? {} };
  } catch {
    return { nav: {}, subnav: {} };
  }
}

export const keymap = $state<Overrides>(read());

function persist() {
  localStorage.setItem(
    KEY,
    JSON.stringify({ nav: keymap.nav, subnav: keymap.subnav }),
  );
}

export const defaultNavKey = (i: number) => String(i + 1);
export const defaultSubnavKey = (i: number) => `shift+${i + 1}`;

/**
 * Keys for places outside the tab bar. They keep chords and letters rather
 * than digits: a digit here would have to follow the tab count, and would move
 * under whoever bound it the moment admin appeared or went.
 */
export const ACTIONS = {
  settings: { label: "settings", key: "ctrl+," },
  feedback: { label: "feedback", key: "ctrl+." },
  artifacts: { label: "artifacts panel", key: "a" },
} as const;

export type Action = keyof typeof ACTIONS;

export function navKey(item: string, i: number): string {
  return keymap.nav[item] ?? defaultNavKey(i);
}

export function subnavKey(i: number): string {
  return keymap.subnav[i] ?? defaultSubnavKey(i);
}

/** Stored in the `nav` bucket beside the tab keys, under the action's name. */
export function actionKey(a: Action): string {
  return keymap.nav[a] ?? ACTIONS[a].key;
}

export function setNavKey(item: string, key: string | null) {
  if (key) keymap.nav[item] = key;
  else delete keymap.nav[item];
  persist();
}

export function setSubnavKey(i: number, key: string | null) {
  if (key) keymap.subnav[i] = key;
  else delete keymap.subnav[i];
  persist();
}

export function resetKeys() {
  keymap.nav = {};
  keymap.subnav = {};
  persist();
}

/* The glyphs normalize() bakes into a stored chord, spelled out. They are the
   right thing on a key cap and the wrong thing in a settings list: "^," is only
   readable to someone who already knows what it says. */
const WORDS: Record<string, string> = {
  "⏎": "ENTER",
  "↑": "UP ARROW",
  "↓": "DOWN ARROW",
  esc: "ESC",
  space: "SPACE",
  backspace: "BACKSPACE",
};

const MODS = /^(shift|ctrl|alt|meta)\+/;

/**
 * A stored chord as the caps a reader presses: "ctrl+," is [[CTRL, ,]] and
 * "g g" is [[G], [G]], one inner list per press. Display only - `normalize()`
 * in keys.svelte.ts still owns what a binding *is*, and every saved keymap is
 * in that spelling.
 */
export function keyCaps(chord: string): string[][] {
  return chord.split(" ").map((part) => {
    const mods: string[] = [];
    let rest = part;
    for (let m = MODS.exec(rest); m; m = MODS.exec(rest)) {
      mods.push(m[1].toUpperCase());
      rest = rest.slice(m[0].length);
    }
    return [...mods, WORDS[rest] ?? rest.toUpperCase()];
  });
}

/** keyCaps as one line of text: CTRL + , and G then G. */
export function keyLabel(chord: string): string {
  return keyCaps(chord)
    .map((caps) => caps.join(" + "))
    .join(" then ");
}

/**
 * Fixed bindings a rebind would shadow. The scope stack resolves innermost
 * first, so a collision does not error - it silently steals the key from
 * whichever view owns it, which is worth warning about before it happens.
 */
export const RESERVED: Record<string, string> = {
  "ctrl+k": "focus search / composer",
  "⏎": "open",
  esc: "back / dismiss",
  backspace: "back",
  space: "select",
  "↑": "move up",
  "↓": "move down",
};

/** What a proposed key would collide with, given the current nav items. */
export function conflicts(
  key: string,
  navItems: { key: string; label: string }[],
  subnavCount: number,
  skip?:
    | { kind: "nav"; item: string }
    | { kind: "subnav"; slot: number }
    | { kind: "action"; item: Action },
): string[] {
  const hits: string[] = [];
  if (RESERVED[key]) hits.push(RESERVED[key]);
  navItems.forEach((n, i) => {
    if (skip?.kind === "nav" && skip.item === n.key) return;
    if (navKey(n.key, i) === key) hits.push(`section “${n.label}”`);
  });
  for (let i = 0; i < subnavCount; i++) {
    if (skip?.kind === "subnav" && skip.slot === i) continue;
    if (subnavKey(i) === key) hits.push(`sub tab ${i + 1}`);
  }
  for (const a of Object.keys(ACTIONS) as Action[]) {
    if (skip?.kind === "action" && skip.item === a) continue;
    if (actionKey(a) === key) hits.push(ACTIONS[a].label);
  }
  return hits;
}
