import { G } from "./glyphs";
import type { Tone } from "./tone";

/** How far along a status is: settled, under way, or not started or off. */
export type LampLevel = "on" | "half" | "off";

/** A status as a lamp: how lit it is, and in which tone. */
export type Lamp = { level: LampLevel; tone: Tone };

export const LAMP_GLYPHS: Record<LampLevel, string> = {
  on: G.dot,
  half: G.half,
  off: G.ring,
};
