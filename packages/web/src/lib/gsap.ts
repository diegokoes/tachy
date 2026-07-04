// Single GSAP entry point: import from here, never from "gsap" directly, so
// registered plugins can't be tree-shaken away. Register only what's used.
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(SplitText);

export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export { gsap, SplitText };
