/**
 * A section's subnav, lifted out of its view so App can carve it into the main
 * window's top edge.
 *
 * It cannot simply be positioned there from inside the view: views render
 * inside the scrolling column, so an absolutely positioned tab bar would
 * scroll away with the content. Registering it here lets App render it as a
 * sibling of the window, against an edge that does not move.
 */
import type { Snippet } from "svelte";

export type SubnavItem = { key: string; label: string };

export type Subnav = {
  items: SubnavItem[];
  active: string;
  onpick: (key: string) => void;
  /**
   * Optional content for the carved row, right of the recess. It rides along
   * with the subnav because that row only exists when there is one — and it
   * travels as a snippet so the view keeps ownership of what it renders
   * instead of App having to know what a section's controls are.
   */
  actions?: Snippet;
};

/**
 * $state.raw, not $state. Plain $state deep-proxies whatever is assigned to it,
 * so the stored value is a Proxy of what was passed in and `stored === passed`
 * is false — which silently broke the identity check in the disposer below, and
 * left admin's tabs on screen after navigating to chat. raw stores the
 * reference itself; the whole value is replaced on every change anyway.
 */
let current = $state.raw<Subnav | null>(null);

export const subnav = () => current;

/**
 * Call from a view's `$effect` and return the result, so the bar clears when
 * the view unmounts. The identity check means a view being replaced by another
 * cannot wipe the incoming view's bar on the way out.
 */
export function setSubnav(next: Subnav) {
  current = next;
  return () => {
    if (current === next) current = null;
  };
}
