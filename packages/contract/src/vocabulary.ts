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
/**
 * What a reference_docs row is. 'reference' is imported source material — an
 * Azure DevOps wiki page, a pasted runbook. 'wiki' is an article authored here,
 * addressed by slug and placed by its categories.
 */
export const REFERENCE_KINDS = ["reference", "wiki"] as const;
/**
 * How one library item points at another. 'mentions' is a [[wikilink]] someone
 * wrote in a body; 'composed_from' records that an article consolidates an item.
 */
export const LINK_KINDS = ["mentions", "composed_from"] as const;
export const CONFIDENCES = ["low", "medium", "high"] as const;
export const FEEDBACK_KINDS = [
  "correction",
  "rating",
  "note",
  "deprecation",
] as const;
/**
 * How an edit to a library item reached the database. `user_id` alone cannot
 * separate these: an agent edit is already attributed to the person whose turn
 * spawned the MCP subprocess, so the door has to be recorded beside them.
 */
export const LIBRARY_ACTORS = ["web", "agent", "mcp", "api", "ingest"] as const;
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
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export type LinkKind = (typeof LINK_KINDS)[number];
export type Confidence = (typeof CONFIDENCES)[number];
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type RunMode = (typeof RUN_MODES)[number];
export type LibraryActor = (typeof LIBRARY_ACTORS)[number];

/** Environments are open-ended, so the rule is a shape rather than a list. */
export const CLOUD_RE = /^[a-z0-9][a-z0-9._/-]*$/;
export const CLOUD_HINT =
  "environment must be a lowercase slug (e.g. prod, qa, demo/preprod)";

/**
 * How hard the agent is asked to think, and which deployment the product is
 * dressed as. Both are offered as a dropdown in the SPA and validated by the
 * API, so both belong here rather than in core, which the SPA cannot import.
 */
export const AGENT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

export const DEPLOYMENT_PROFILES = ["support", "engineering"] as const;
export type DeploymentProfile = (typeof DEPLOYMENT_PROFILES)[number];

/**
 * The wizard refuses a shorter one in the field, and hashPassword refuses it
 * again on the way in. Two enforcement points, so one number.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * What a slug may look like. `SLUG_RE` is the strict form most things use;
 * environments and customer units are looser, and say so where they differ.
 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Lowercases and hyphenates a typed name into something SLUG_RE accepts. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
