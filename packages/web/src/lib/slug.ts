/** The machine id behind a display name: lowercase, kebab, ascii-safe. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
