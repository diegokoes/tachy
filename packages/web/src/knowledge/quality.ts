type QualityTone = "muted" | "warn" | "ok";

/**
 * Confidence (is the entry right?) and clarity (did the ticket end in a fix?)
 * are different questions on one three-step scale.
 */
const STEPS: Record<string, number> = {
  low: 1,
  unclear: 1,
  medium: 2,
  partial: 2,
  high: 3,
  clear: 3,
};
const STEP_COUNT = 3;
const STEP_TONES: Record<number, QualityTone> = {
  1: "muted",
  2: "warn",
  3: "ok",
};

/** Where `value` sits on the scale, 0 to 1, and its tone; null when unset. */
export function qualityMeter(
  value: string | null | undefined,
): { fraction: number; tone: QualityTone } | null {
  const step = value ? STEPS[value] : undefined;
  if (!step) return null;
  return { fraction: step / STEP_COUNT, tone: STEP_TONES[step] };
}
