/** An event's detail as one line: `role: admin · team: support`. */
export function detailText(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(
      ([key, value]) =>
        `${key.replaceAll("_", " ")}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    )
    .join(" · ");
}
