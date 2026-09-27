/**
 * An entry's `structured` blob as an object, whatever shape the row arrives in.
 *
 * The write path validates it as an object, so nothing the app saves can be
 * anything else. Some older seeded rows hold double-encoded jsonb, the JSON
 * *text*, and `Object.entries` over a string yields one entry per character.
 */
export function asStructured(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asStructured(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
