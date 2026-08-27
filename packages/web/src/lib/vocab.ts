/**
 * The controlled vocabularies come from `@tachy/contract` — the same lists the
 * API validates against and `db/schema.sql` constrains. Re-exported here so the
 * SPA's call sites have one import to reach for.
 */
import {
  CONFIDENCES,
  RESOLUTION_CLARITIES,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
} from "@tachy/contract";

export {
  CONFIDENCES,
  RESOLUTION_CLARITIES,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
};

/**
 * Keys whose values come from a fixed list wherever they appear — used to give
 * a tool-input field a dropdown instead of a free-text box.
 */
export const ENUM_FIELDS: Record<string, readonly string[]> = {
  confidence: CONFIDENCES,
  resolution_clarity: RESOLUTION_CLARITIES,
  status: KNOWLEDGE_STATUSES,
};
