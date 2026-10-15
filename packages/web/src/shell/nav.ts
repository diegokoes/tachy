import type { IconName } from "../tui/icons";

export type NavItem = {
  key: string;
  label: string;
  icon?: IconName;
  badge?: number;
};

const SECTIONS: NavItem[] = [
  { key: "chat", label: "chat", icon: "chat" },
  { key: "board", label: "board", icon: "board" },
  { key: "library", label: "library", icon: "library" },
  { key: "wiki", label: "wiki", icon: "wiki" },
  { key: "console", label: "console", icon: "admin" },
];

/** The tab bar's items, in hotkey order. */
export function navItems(): NavItem[] {
  return SECTIONS;
}
