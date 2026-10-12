import { untrack } from "svelte";
import type { HeadAction } from "../sections/Section.svelte";

/**
 * The buttons on a section's heading line: its "add" and at most one more verb.
 * Data, not a snippet, so `tui` need not know the page layout: a CrudTable
 * offers `{ label, run }` and the page places it. Keyed by section, since every
 * section of a page is mounted at once. `$state.raw`, since `$state` would
 * proxy the object and break the identity check.
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

// Claiming reads the map to write it, and is called from inside CrudTable's
// `$effect`. Untracked, or that effect would depend on the state it writes and
// re-run forever.
function edit(
  change: (was: Record<string, SectionAction>) => Record<string, SectionAction>,
) {
  untrack(() => (claims = change(claims)));
}

/**
 * Claims one section's action and returns the disposer that gives it back. The
 * disposer checks identity: a panel re-offering the same action must not
 * clobber a claim made after it.
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

/** How long a panel has to offer its action after the route reaches it. */
const OFFER_WAIT_MS = 4000;

/**
 * Runs a section's action once its panel offers it, for a caller that has just
 * navigated there and cannot press the button itself. A panel that never
 * offers one, for want of a permission, leaves the reader on the section.
 */
export function runWhenOffered(section: string, slot: SectionSlot = "add") {
  let done = false;
  const stop = $effect.root(() => {
    $effect(() => {
      const action = sectionAction(section, slot);
      if (!action || done) return;
      done = true;
      untrack(action.run);
      queueMicrotask(finish);
    });
  });
  const timer = setTimeout(finish, OFFER_WAIT_MS);
  function finish() {
    clearTimeout(timer);
    stop();
  }
}
