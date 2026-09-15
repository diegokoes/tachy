/**
 * The element the app actually scrolls — `main` inside the window frame, not
 * the document. Anything that has to measure scroll position (ScrollTrigger
 * needs it as `scroller`) is nowhere near App.svelte, so the element is
 * published here rather than threaded down through every view.
 *
 * $state.raw and an identity-checked disposer, for the same reason as the
 * subnav store: a proxied element would not compare equal to the one handed in.
 */
let el = $state.raw<HTMLElement | null>(null);

export const scrollport = () => el;

export function setScrollport(next: HTMLElement | null): () => void {
  el = next;
  return () => {
    if (el === next) el = null;
  };
}
