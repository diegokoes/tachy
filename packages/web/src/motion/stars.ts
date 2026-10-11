import { gsap } from "./gsap";

const GLYPHS = ["·", "·", "·", "*", "+", "'"];

/** Position in % of the layer, size in rem, `dim` the opacity it rests at. */
export type Star = {
  glyph: string;
  x: number;
  y: number;
  size: number;
  dim: number;
};

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Stars scattered over a layer. Percentages, so the layer reflows with its box
 * without laying them out again.
 */
export function scatter(count: number): Star[] {
  return Array.from({ length: count }, () => ({
    glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
    x: rand(0, 100),
    y: rand(0, 100),
    size: rand(0.6, 1.25),
    // The floor is this high because it multiplies into --star-ink and again
    // into the twinkle: lower, the faintest stars are in the DOM and invisible
    // on screen.
    dim: rand(0.6, 1),
  }));
}

/**
 * Long, offset durations so a field never pulses in unison - synchronised
 * blinking reads as a loading state, not as sky. A twinkle, not a blink:
 * dipping to a quarter reads as stars flickering out rather than breathing.
 * Intense dips further and cycles faster.
 */
export function twinkle(el: Element, star: Star, intense = false) {
  return gsap.to(el, {
    opacity: star.dim * (intense ? rand(0.3, 0.7) : rand(0.5, 0.75)),
    duration: intense ? rand(1.1, 3) : rand(3, 7),
    delay: intense ? rand(0, 2.5) : rand(0, 6),
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });
}
