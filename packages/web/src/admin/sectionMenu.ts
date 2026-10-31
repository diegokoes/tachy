import { compact } from "../tui/figures";
import type { MenuItem } from "../tui/menu";
import type { ConsoleSection } from "./pages";

/** The row that leaves a section for its page's overview. */
export const OVERVIEW_ROW = "overview";

/**
 * The console corner's menu: the page's sections, each with its count once the
 * census has one, and, while a section is open, a first row back to the
 * overview.
 */
export function sectionMenu(
  sections: ConsoleSection[],
  counts: Record<string, number> | null,
  open?: string,
): MenuItem[] {
  const rows = sections.map((section) => ({
    key: section.key,
    label: section.label,
    hint: section.n && counts ? compact(counts[section.n] ?? 0) : undefined,
    current: section.key === open,
  }));
  return open ? [{ key: OVERVIEW_ROW, label: "‹ overview" }, ...rows] : rows;
}
