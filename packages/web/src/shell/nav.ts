import { isCurator, session } from "../access/session.svelte";
import type { IconName } from "../tui/icons";

export type NavItem = { key: string; label: string; icon?: IconName };

const SECTIONS: NavItem[] = [
  { key: "chat", label: "chat", icon: "chat" },
  { key: "library", label: "library", icon: "library" },
  { key: "wiki", label: "wiki", icon: "wiki" },
  { key: "admin", label: "admin", icon: "admin" },
];

/** The tab bar's items, in hotkey order. */
export function navItems(): NavItem[] {
  return !isCurator() && session.me
    ? SECTIONS.filter((n) => n.key !== "admin")
    : SECTIONS;
}
