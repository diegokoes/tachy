/**
 * A comma-separated field, as a list. Everything between two commas is one
 * value, so a value containing spaces needs no quoting — and quoting it would
 * store the quote marks.
 */
export const csv = (v: string | undefined) =>
  v
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];
