/**
 * Controlled vocabularies, mirrored from `packages/core/src/knowledge/structured.ts`.
 *
 * The SPA talks to the API over HTTP and does not depend on core, so these lists
 * cannot be imported — they are duplicated here deliberately, in one place
 * rather than inline at each call site. A change to the enums in core has to
 * land here too; the check constraints in `db/schema.sql` are the backstop.
 */
export const CONFIDENCES = ["low", "medium", "high"] as const;
export const RESOLUTION_CLARITIES = ["clear", "partial", "unclear"] as const;
export const LEARNING_VALUES = ["high", "medium", "low"] as const;
export const KNOWLEDGE_STATUSES = [
  "draft",
  "approved",
  "deprecated",
  "archived",
  "rejected",
] as const;
export const REFERENCE_STATUSES = ["draft", "approved", "archived"] as const;

/**
 * Keys whose values come from a fixed list wherever they appear — used to give
 * a tool-input field a dropdown instead of a free-text box.
 */
export const ENUM_FIELDS: Record<string, readonly string[]> = {
  confidence: CONFIDENCES,
  resolution_clarity: RESOLUTION_CLARITIES,
  learning_value: LEARNING_VALUES,
  status: KNOWLEDGE_STATUSES,
};
