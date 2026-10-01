import type { Snippet } from "svelte";

/**
 * Controls a record page puts in admin's top tab, where the overview keeps
 * its issues. $state.raw for the identity check in the disposer, as in the
 * subnav store.
 */
let current = $state.raw<Snippet | null>(null);

export const pageActions = () => current;

/** Call from the page's `$effect` and return the result. */
export function setPageActions(next: Snippet) {
  current = next;
  return () => {
    queueMicrotask(() => {
      if (current === next) current = null;
    });
  };
}
