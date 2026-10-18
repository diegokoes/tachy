import type { IconName } from "../tui/icons";

export type NavItem = { key: string; label: string; icon?: IconName };

const SECTIONS: NavItem[] = [
  { key: "chat", label: "chat", icon: "chat" },
  { key: "board", label: "board", icon: "board" },
  { key: "library", label: "library", icon: "library" },
  { key: "console", label: "console", icon: "admin" },
  { key: "settings", label: "settings", icon: "settings" },
];

/** The tab bar's items, in hotkey order. */
export function navItems(): NavItem[] {
  return SECTIONS;
}

/** Sections with no tab of their own, by the tab they open from. */
const HOSTED: Record<string, string> = { wiki: "library" };

/** The tab lit while `section` is open. */
export const tabOf = (section: string) => HOSTED[section] ?? section;
