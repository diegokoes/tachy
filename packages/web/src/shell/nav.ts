import type { IconName } from "../tui/icons";

export type NavItem = { key: string; label: string; icon?: IconName };

const SECTIONS: NavItem[] = [
  { key: "chat", label: "chat", icon: "chat" },
  { key: "board", label: "board", icon: "board" },
  { key: "library", label: "library", icon: "library" },
  { key: "console", label: "console", icon: "admin" },
];

/** The tab bar's items, in hotkey order. */
export function navItems(): NavItem[] {
  return SECTIONS;
}

/** Sections with no tab of their own, by the tab they open from. */
const HOSTED: Record<string, string> = { wiki: "library" };

/** The tab lit while `section` is open. */
export const tabOf = (section: string) => HOSTED[section] ?? section;

/** Opens over the whole window, with no tab and no host. */
const STANDALONE = ["feedback"];

/** Opens in the window from the top bar's corner, with no tab. */
const CORNERED = ["settings"];

/** Whether `key` names a section the app renders, as a path's first segment. */
export const isSection = (key: string) =>
  SECTIONS.some((s) => s.key === key) ||
  key in HOSTED ||
  STANDALONE.includes(key) ||
  CORNERED.includes(key);
