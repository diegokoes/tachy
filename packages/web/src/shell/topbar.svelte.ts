/**
 * A view's claim on the top bar, registered here because App draws the bar and
 * a view cannot reach it. Tucked, the bar leaves the layout so the window
 * takes its row, and comes back over the page while the pointer is at the top
 * edge.
 */
export const topbar = $state({
  tucked: false,
  /** Back in its row but unseen, until the view that let it go shows it. */
  veiled: false,
  /** The bar itself, for a view that moves it along with its own parts. */
  el: undefined as HTMLElement | undefined,
});

/** Call from a view's `$effect` and return the result, as with `setSubnav`. */
export function tuckTopbar(): () => void {
  topbar.tucked = true;
  topbar.veiled = false;
  return () => {
    topbar.tucked = false;
  };
}

/** Holds the bar unseen through whatever the view plays before `unveilTopbar`. */
export function veilTopbar() {
  topbar.veiled = true;
}

export function unveilTopbar() {
  topbar.veiled = false;
}
