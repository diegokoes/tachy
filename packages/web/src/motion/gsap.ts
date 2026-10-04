import { gsap } from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { Flip } from "gsap/Flip";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { Physics2DPlugin } from "gsap/Physics2DPlugin";

gsap.registerPlugin(
  DrawSVGPlugin,
  Flip,
  MorphSVGPlugin,
  ScrollToPlugin,
  ScrollTrigger,
  SplitText,
  Physics2DPlugin,
);

export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export {
  gsap,
  DrawSVGPlugin,
  Flip,
  MorphSVGPlugin,
  ScrollToPlugin,
  ScrollTrigger,
  SplitText,
  Physics2DPlugin,
};
