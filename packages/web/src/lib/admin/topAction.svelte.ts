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

/**
 * Claim the row, and return the disposer that gives it back — the same shape as
 * setSubnav and setTopActions, and for the same reason. Switching admin sections
 * registers the incoming panel's claim before the outgoing panel's teardown
 * runs, so a teardown that clears unconditionally wipes the button that has just
 * been offered. The identity check is what the `$state.raw` above is for.
 */
export function claimTopAction(next: TopAction | null): () => void {
  claim = next;
  return () => {
    if (claim === next) claim = null;
  };
}
