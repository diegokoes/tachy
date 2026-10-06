/**
 * The element the app scrolls: `main` inside the window frame, not the
 * document. Published here because what measures scroll position (ScrollTrigger
 * takes it as `scroller`) sits far from App.svelte. `$state.raw` because the
 * disposer compares by identity and a proxied element would not match.
 */
let el = $state.raw<HTMLElement | null>(null);

export const scrollport = () => el;

export function setScrollport(next: HTMLElement | null): () => void {
  el = next;
  return () => {
    if (el === next) el = null;
  };
}
