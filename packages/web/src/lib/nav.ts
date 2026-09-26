import { isCurator, session } from "./session.svelte";
import type { IconName } from "./tui/icons";

export type NavItem = { key: string; label: string; icon?: IconName };

const ALL: NavItem[] = [
  { key: "chat", label: "chat", icon: "chat" },
  { key: "library", label: "library", icon: "library" },
  { key: "wiki", label: "wiki", icon: "wiki" },
  { key: "admin", label: "admin", icon: "admin" },
];

/** The tab bar, in hotkey order — 1..n. */
export function navItems(): NavItem[] {
  return !isCurator() && session.me
    ? ALL.filter((n) => n.key !== "admin")
    : ALL;
}

/** The digit that continues the tab bar's numbering, for in-view hotkeys. */
export function nextNavKey(): number {
  return navItems().length + 1;
}
