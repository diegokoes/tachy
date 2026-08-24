/**
 * The grade bands. `relevance()` itself stays in `@tachy/core` — the score is
 * calibrated against the embedding model's measured distribution and is
 * computed once, server-side, so every surface reads the same number. What the
 * client needs is only where the bands fall, for the gauge's tick marks.
 */

/** Below GOOD a hit is noise; at or above STRONG it is a confident match. */
export const GOOD = 0.35;
export const STRONG = 0.7;

export type Grade = "strong" | "good" | "weak";

export const grade = (v: number): Grade =>
  v >= STRONG ? "strong" : v >= GOOD ? "good" : "weak";
