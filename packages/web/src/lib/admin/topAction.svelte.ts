/**
 * A section's "add" button, lifted into the row carved out of the window's top
 * edge — the corner every other section already uses and admin left empty.
 *
 * It travels as data rather than as a snippet so that `tui` never has to know
 * about the window frame: a CrudTable offers `{ label, run }` and whoever is
 * laying out the page decides where that gets drawn.
 *
 * $state.raw, not $state, for the same reason as the subnav store: plain
 * $state would deep-proxy the object and break the identity check below.
 */
export type TopAction = { label: string; run: () => void };

let claim = $state.raw<TopAction | null>(null);

export const topAction = () => claim;

/** Pass null to give the row back. Safe to call from an $effect teardown. */
export function claimTopAction(next: TopAction | null) {
  if (next === null) claim = null;
  else claim = next;
}
