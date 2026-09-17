/**
 * User overrides for the two key sets the tabs used to advertise with
 * superscript digits. Everything else in the app keeps its fixed binding and is
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
/** Settings lives outside the tab bar, so it keeps a chord rather than a digit. */
export const defaultSettingsKey = "ctrl+,";

export function navKey(item: string, i: number): string {
  return keymap.nav[item] ?? defaultNavKey(i);
}

export function subnavKey(i: number): string {
  return keymap.subnav[i] ?? defaultSubnavKey(i);
}

/** Stored in the same `nav` bucket as the tab bar's own keys — settings just
 *  isn't one of the items `navItems()` enumerates, so it can't collide with a
 *  digit fallback the way a real slot's key could. */
export function settingsKey(): string {
  return keymap.nav.settings ?? defaultSettingsKey;
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
 * A stored chord as a reader should see it: "ctrl+," is CTRL + ,  and "g g" is
 * G then G. Display only — `normalize()` in keys.svelte.ts still owns what a
 * binding *is*, and every saved keymap is in that spelling.
 */
export function keyLabel(chord: string): string {
  return chord
    .split(" ")
    .map((part) => {
      const mods: string[] = [];
      let rest = part;
      for (let m = MODS.exec(rest); m; m = MODS.exec(rest)) {
        mods.push(m[1].toUpperCase());
        rest = rest.slice(m[0].length);
      }
      return [...mods, WORDS[rest] ?? rest.toUpperCase()].join(" + ");
    })
    .join(" then ");
}

/**
 * Fixed bindings a rebind would shadow. The scope stack resolves innermost
 * first, so a collision does not error — it silently steals the key from
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
    | { kind: "settings" },
): string[] {
  const hits: string[] = [];
  if (RESERVED[key]) hits.push(RESERVED[key]);
  navItems.forEach((n, i) => {
    if (skip?.kind === "nav" && skip.item === n.key) return;
    if (navKey(n.key, i) === key) hits.push(`section “${n.label}”`);
  });
  for (let i = 0; i < subnavCount; i++) {
    if (skip?.kind === "subnav" && skip.slot === i) continue;
    if (subnavKey(i) === key) hits.push(`subnav tab ${i + 1}`);
  }
  if (skip?.kind !== "settings" && settingsKey() === key) hits.push("settings");
  return hits;
}
