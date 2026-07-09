import { z } from "zod";
import { badInput } from "../platform/errors";






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



export function parseStructured(value: unknown): Structured {
  if (value == null) return {};
  const res = structuredSchema.safeParse(value);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join(".") || "structured"}: ${i.message}`).join("; ");
    throw badInput(`Invalid structured field: ${issues}`);
  }
  return res.data;
}




export const RESOLUTION_CLARITIES = ["clear", "partial", "unclear"] as const;
export const LEARNING_VALUES = ["high", "medium", "low"] as const;

export const cloudSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._/-]*$/, "environment must be a lowercase slug (e.g. prod, qa, demo/preprod)");
export const resolutionClaritySchema = z.enum(RESOLUTION_CLARITIES);
export const learningValueSchema = z.enum(LEARNING_VALUES);



export const KNOWLEDGE_STATUSES = ["draft", "approved", "rejected", "archived", "deprecated"] as const;
export const REFERENCE_STATUSES = ["draft", "approved", "archived"] as const;
export const CONFIDENCES = ["low", "medium", "high"] as const;
export const FEEDBACK_KINDS = ["correction", "rating", "note", "deprecation"] as const;
export const RUN_MODES = ["ingest", "consult", "sync"] as const;

export const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);
export const referenceStatusSchema = z.enum(REFERENCE_STATUSES);
export const confidenceSchema = z.enum(CONFIDENCES);
export const feedbackKindSchema = z.enum(FEEDBACK_KINDS);
export const runModeSchema = z.enum(RUN_MODES);
