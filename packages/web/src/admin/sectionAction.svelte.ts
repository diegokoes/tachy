import { untrack } from "svelte";
import type { HeadAction } from "../sections/Section.svelte";

/**
 * The buttons drawn on a section's heading line: its "add", and at most one
 * more verb beside it.
 *
 * It travels as data rather than as a snippet so that `tui` never has to know
 * about the page layout: a CrudTable offers `{ label, run }` and whoever lays
 * out the page decides where that gets drawn.
 *
 * Keyed by section, because every section of a page is mounted at once and a
 * single claim would be won by whichever panel happened to mount last.
 *
 * $state.raw, not $state, for the same reason as the subnav store: plain
 * $state would deep-proxy the object and break the identity check below.
 */
export type SectionAction = HeadAction;

/**
 * Where on the heading a claim is drawn. `add` is the CrudTable's, rightmost;
 * `aside` is one more verb a panel wants beside it.
 */
export type SectionSlot = "add" | "aside";

let claims = $state.raw<Record<string, SectionAction>>({});

const keyOf = (section: string, slot: SectionSlot) =>
  slot === "add" ? section : `${section}:${slot}`;

export const sectionAction = (
  section: string | undefined,
  slot: SectionSlot = "add",
) => (section ? claims[keyOf(section, slot)] : undefined);

/** Every action drawn on one section's heading, left to right. */
export const sectionActions = (section: string): SectionAction[] =>
  (["aside", "add"] as const)
    .map((slot) => claims[keyOf(section, slot)])
    .filter((a): a is SectionAction => Boolean(a));

/* Claiming has to read the map to write it, and it is called from inside
   CrudTable's $effect. Untracked, or that effect would depend on the state it
   just wrote and re-run itself forever. */
function edit(
  fn: (was: Record<string, SectionAction>) => Record<string, SectionAction>,
) {
  untrack(() => (claims = fn(claims)));
}

/**
 * Claim one section's action, and return the disposer that gives it back. The
 * identity check is what the `$state.raw` above is for: a panel re-offering the
 * same action must not clobber a claim made after it.
 */
export function claimSectionAction(
  section: string,
  next: SectionAction | null,
  slot: SectionSlot = "add",
): () => void {
  const key = keyOf(section, slot);
  edit(({ [key]: _gone, ...rest }) => (next ? { ...rest, [key]: next } : rest));
  return () =>
    edit((was) => {
      if (was[key] !== next) return was;
      const { [key]: _dropped, ...without } = was;
      return without;
    });
}

/**
 * The `hoist` a panel hands its CrudTable. Memoised per section because
 * CrudTable reads it inside an `$effect`; a fresh closure on every render
 * would tear down and re-make the claim on every keystroke in the table's
 * filter box.
 */
const hoists: Record<string, (a: SectionAction | null) => () => void> = {};

export function sectionHoist(section: string) {
  return (hoists[section] ??= (a: SectionAction | null) =>
    claimSectionAction(section, a));
}
