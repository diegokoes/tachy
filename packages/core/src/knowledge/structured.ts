import { z } from "zod";
import { badInput } from "../platform/errors";

// Documents + validates the `structured` JSONB on knowledge entries. Everything is
// optional and the object is passthrough: this is a contract, not a straitjacket —
// extra keys are kept, but the documented narrative fields get a known shape so the
// data stays consistent across entries. The low-cardinality, filterable facets
// (cloud / quality) live as real columns now, NOT in here.
export const structuredSchema = z
  .object({
    environment: z
      .object({
        machine: z.string().optional(),
        line: z.string().optional(),
        component: z.string().optional(),
      })
      .passthrough()
      .optional(),
    key_signals: z
      .object({
        error_description: z.string().optional(),
        context: z.string().optional(),
      })
      .passthrough()
      .optional(),
    investigation_steps: z.array(z.string()).optional(),
    conversation_summary: z.string().optional(),
    technical_analysis: z
      .object({
        what_happened: z.string().optional(),
        why: z.string().optional(),
        system_behavior: z.string().optional(),
      })
      .passthrough()
      .optional(),
    constraints_and_rules: z.array(z.string()).optional(),
    related_configuration: z.array(z.string()).optional(),
    related_links: z.array(z.string()).optional(),
  })
  .passthrough();

export type Structured = z.infer<typeof structuredSchema>;

// Validate (and normalize) a `structured` blob, turning a schema failure into a
// clean bad_input AppError so it maps to 400 / a tool error consistently.
export function parseStructured(value: unknown): Structured {
  if (value == null) return {};
  const res = structuredSchema.safeParse(value);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join(".") || "structured"}: ${i.message}`).join("; ");
    throw badInput(`Invalid structured field: ${issues}`);
  }
  return res.data;
}

// The four promoted facets, shared by knowledge save/update across MCP + API.
export const CLOUDS = ["prod", "qa", "private-cloud", "on-prem"] as const;
export const RESOLUTION_CLARITIES = ["clear", "partial", "unclear"] as const;
export const LEARNING_VALUES = ["high", "medium", "low"] as const;

export const cloudSchema = z.enum(CLOUDS);
export const resolutionClaritySchema = z.enum(RESOLUTION_CLARITIES);
export const learningValueSchema = z.enum(LEARNING_VALUES);
