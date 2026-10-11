import type { SubnavItem } from "../shell/subnav.svelte";

/** Settings' tabs, in subnav order. SettingsView lays each one out. */
export const SETTINGS_TABS: SubnavItem[] = [
  { key: "theme", label: "theme", icon: "theme" },
  { key: "keybinds", label: "keybinds", icon: "keybinds" },
  { key: "agent", label: "agent", icon: "agent" },
];
