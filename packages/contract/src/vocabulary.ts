/**
 * The controlled vocabularies, in the order they should be offered. Both the
 * API's zod schemas and the SPA's dropdowns are built from these lists, and
 * `test/schema-drift.test.ts` holds them against the CHECK constraints in
 * `db/schema.sql`.
 */

export const RESOLUTION_CLARITIES = ["clear", "partial", "unclear"] as const;

export const KNOWLEDGE_STATUSES = [
  "draft",
  "approved",
  "rejected",
  "archived",
  "deprecated",
] as const;
export const REFERENCE_STATUSES = ["draft", "approved", "archived"] as const;
export const CONFIDENCES = ["low", "medium", "high"] as const;
export const FEEDBACK_KINDS = [
  "correction",
  "rating",
  "note",
  "deprecation",
] as const;
export const RUN_MODES = [
  "ingest",
  "consult",
  "sync",
  "create",
  "code",
  "chat",
] as const;

export type ResolutionClarity = (typeof RESOLUTION_CLARITIES)[number];
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number];
export type Confidence = (typeof CONFIDENCES)[number];
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type RunMode = (typeof RUN_MODES)[number];

/** Environments are open-ended, so the rule is a shape rather than a list. */
export const CLOUD_RE = /^[a-z0-9][a-z0-9._/-]*$/;
export const CLOUD_HINT =
  "environment must be a lowercase slug (e.g. prod, qa, demo/preprod)";
