import { z } from "zod";
import {
  CLOUD_RE,
  CLOUD_HINT,
  MAX_ENTRY_TITLE_CHARS,
  RELATED_LINK_HINT,
  isRelatedLink,
  RESOLUTION_CLARITIES,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
  REFERENCE_KINDS,
  LINK_KINDS,
  CONFIDENCES,
  FEEDBACK_KINDS,
  RUN_MODES,
} from "@tachy/contract";

export {
  RESOLUTION_CLARITIES,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
  REFERENCE_KINDS,
  LINK_KINDS,
  CONFIDENCES,
  FEEDBACK_KINDS,
  RUN_MODES,
};

export const cloudSchema = z.string().regex(CLOUD_RE, CLOUD_HINT);
export const entryTitleSchema = z.string().min(1).max(MAX_ENTRY_TITLE_CHARS);
export const relatedLinksSchema = z.array(
  z.string().refine(isRelatedLink, RELATED_LINK_HINT),
);
export const resolutionClaritySchema = z.enum(RESOLUTION_CLARITIES);

export const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);
export const referenceStatusSchema = z.enum(REFERENCE_STATUSES);
export const referenceKindSchema = z.enum(REFERENCE_KINDS);
export const confidenceSchema = z.enum(CONFIDENCES);
export const feedbackKindSchema = z.enum(FEEDBACK_KINDS);
export const runModeSchema = z.enum(RUN_MODES);
