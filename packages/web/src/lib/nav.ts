import { isCurator, session } from "./session.svelte";

export type NavItem = { key: string; label: string };

const ALL: NavItem[] = [
  { key: "chat", label: "chat" },
  { key: "library", label: "library" },
  { key: "admin", label: "admin" },
  { key: "settings", label: "settings" },
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
