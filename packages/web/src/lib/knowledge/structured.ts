/**
 * An entry's `structured` blob as an object, whatever shape the row arrives in.
 *
 * The write path validates it as an object, so nothing the app saves can be
 * anything else. Rows seeded before the seeder stopped double-encoding jsonb
 * hold the JSON *text* instead — and `Object.entries` over a string yields one
 * entry per character, which is how a one-key blob came to render as a numbered
 * map of braces and quotes.
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
