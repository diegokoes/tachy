import { SETTINGS_TABS } from "./tabs";

/** A run of text, or the "settings › <tab>" in it with the tab's path. */
export type PointerPart = { text: string; href?: string };

const POINTER = /settings › (\w+)/gi;
const TAB_KEYS = new Set(SETTINGS_TABS.map((t) => t.key));

/**
 * Splits a message at each "settings › <tab>" naming a real settings tab, so
 * the place it sends the reader to can be a link. Other text, and a name no
 * tab carries, stay plain.
 */
export function settingsPointers(text: string): PointerPart[] {
  const parts: PointerPart[] = [];
  let at = 0;
  for (const match of text.matchAll(POINTER)) {
    const tab = match[1].toLowerCase();
    if (!TAB_KEYS.has(tab)) continue;
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ text: match[0], href: `/settings/${tab}` });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
