import type { NavItem } from "../shell/nav";
import type { Subnav } from "../shell/subnav.svelte";

const TYPED_KEY = "tachy-recess-typed";

/** The longest a recess line takes to type, so the tabs are never held back. */
export const RECESS_TYPING_MS = 450;

/**
 * The line a section's recess types on its first visit, as the bars name the
 * places: `› console/integrations`. A lone tab is left out, since the section
 * already names the only place in it.
 */
export function recessLine(section: NavItem, bar: Subnav): string {
  const tab =
    bar.items.length > 1
      ? bar.items.find((item) => item.key === bar.active)
      : undefined;
  return tab ? `› ${section.label}/${tab.label}` : `› ${section.label}`;
}

/**
 * Whether `section`'s recess types now: on its first visit this session, then
 * never again. Storage that will not answer types nothing, so the line cannot
 * repeat on every visit.
 */
export function claimFirstVisit(section: string): boolean {
  try {
    const typed: string[] = JSON.parse(
      sessionStorage.getItem(TYPED_KEY) ?? "[]",
    );
    if (typed.includes(section)) return false;
    sessionStorage.setItem(TYPED_KEY, JSON.stringify([...typed, section]));
    return true;
  } catch {
    return false;
  }
}
