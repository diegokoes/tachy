/*
 * The machine id behind a display name. From the contract, not reimplemented
 * here: the server validates what this produces, and the two had already
 * drifted — a unit slug the API would have accepted was rewritten on the way in.
 */
export { slugify } from "@tachy/contract";

/**
 * Every create route upserts on its slug, so a collision would silently
 * overwrite the record it collided with rather than fail. Derived slugs suffix
 * their way clear instead.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  if (!base) return base;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
