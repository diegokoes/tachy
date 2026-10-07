/**
 * A section's subnav, registered here so App renders it in the main window's
 * top edge. A view cannot place it there: views render inside the scrolling
 * column, and a tab bar positioned from one would scroll away with the content.
 */
import type { Snippet } from "svelte";
import type { IconName } from "../tui/icons";

export type SubnavItem = { key: string; label: string; icon?: IconName };

export type Subnav = {
  /** Empty for a section with no places of its own; the recess is still drawn. */
  items: SubnavItem[];
  active: string;
  onpick: (key: string) => void;
  /**
   * Content for the row right of the recess. A snippet, so the view owns what
   * it renders and App needs no knowledge of a section's controls.
   */
  actions?: Snippet;
};

/**
 * `$state.raw`: the disposer compares by identity, and `$state` would store a
 * proxy of the value instead of the value.
 */
let current = $state.raw<Subnav | null>(null);

export const subnav = () => current;

/**
 * Call from a view's `$effect` and return the result, so the bar clears when
 * the view unmounts. The identity check keeps an outgoing view from clearing
 * the incoming view's bar. The clear is deferred a microtask: the disposer
 * runs while App's `{#if sub}` branch is still mounted, and nulling `current`
 * inside that flush makes the tab bar read `sub.items` through null.
 */
export function setSubnav(next: Subnav) {
  current = next;
  return () => {
    queueMicrotask(() => {
      if (current === next) current = null;
    });
  };
}

/**
 * A nested view's claim on the row, overriding its section's `actions`. A
 * detail view or a form sits several levels below the `setSubnav` call and
 * cannot amend it. `$state.raw` for the same identity check as `current`.
 */
let claimed = $state.raw<Snippet | null>(null);

export const topActions = () => claimed;

/** Call from a view's `$effect` and return the result, as with `setSubnav`. */
export function setTopActions(next: Snippet) {
  claimed = next;
  return () => {
    if (claimed === next) claimed = null;
  };
}
