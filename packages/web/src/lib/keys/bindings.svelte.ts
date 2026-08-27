/**
 * User overrides for the two key sets the tabs used to advertise with
 * superscript digits. Everything else in the app keeps its fixed binding and is
 * listed read-only in Settings › keybinds.
 *
 * Section keys are stored per nav item, not per slot: navItems() drops `admin`
 * for non-curators, so slot 3 is `admin` for one user and `settings` for the
 * next. Subnav keys are stored per slot, because subnav items differ by section
 * and ⇧1..⇧n is meaningful as a set rather than per destination.
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

export function navKey(item: string, i: number): string {
  return keymap.nav[item] ?? defaultNavKey(i);
}

export function subnavKey(i: number): string {
  return keymap.subnav[i] ?? defaultSubnavKey(i);
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
  skip?: { kind: "nav"; item: string } | { kind: "subnav"; slot: number },
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
  return hits;
}
