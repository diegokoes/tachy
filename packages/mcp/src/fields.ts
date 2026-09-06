import { z } from "zod";

/**
 * Fields more than one tool takes. Named so the wording travels with the field
 * rather than being written out per tool — and so two tools taking the same
 * field cannot come to describe it differently.
 */

/**
 * The single most common tool-call mistake is passing the source *type* here.
 * Every tool that takes one reuses this so the correction travels with the field
 * rather than living in the system prompt.
 */
export const sourceSlug = z
  .string()
  .describe(
    "Source CONNECTION SLUG from list_source_connections (e.g. 'osapiens-freshdesk'), never the source type ('freshdesk', 'azure-devops'). Call list_source_connections first if you do not have it.",
  );

export const structuredField = z
  .record(z.string(), z.any())
  .optional()
  .describe(
    "Narrative context — stored and returned wholesale, never filtered on. Include only the keys that apply; don't force empty objects. Known shape: environment {machine, line, component}, key_signals {error_description, context}, investigation_steps [], conversation_summary, technical_analysis {what_happened, why, system_behavior}, constraints_and_rules [], related_configuration [], related_links [] (full URLs). Extra keys are kept.",
  );

export const symptomsField = z
  .array(z.string())
  .optional()
  .describe(
    "Observable behaviours, as short phrases rather than sentences. Facts, not interpretations: 'Error 023 in logs' yes, 'possible template issue' no.",
  );

export const signalsField = z
  .array(z.string())
  .optional()
  .describe(
    "Raw searchable identifiers exactly as they appear — error codes, log patterns, status codes: ['023 TOO_MANY_STRINGS', 'ECONNREFUSED', 'HTTP 503']. Trigram-indexed, so a future search for '023' matches.",
  );

export const tagsField = z
  .array(z.string())
  .optional()
  .describe(
    "Free-form labels for filtering. Call list_labels first and reuse a slug rather than inventing a near-duplicate; a component slug used as a tag makes the entry findable by component.",
  );
