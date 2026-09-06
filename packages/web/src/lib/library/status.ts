/**
 * How a library item's status is coloured. One function over the union of both
 * vocabularies: knowledge entries can be rejected or deprecated and reference
 * docs cannot, so a doc simply never reaches those arms — where two copies of
 * this meant `deprecated` was a warning in one view and unstyled in the other.
 */
export const statusTone = (s: string) =>
  s === "approved"
    ? "ok"
    : s === "draft"
      ? "accent"
      : s === "rejected"
        ? "danger"
        : s === "deprecated"
          ? "warn"
          : "muted";
