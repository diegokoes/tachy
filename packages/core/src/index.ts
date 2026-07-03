// Public API of @tachy/core, aggregated from the domain modules under src/*.
// The surface is curated here (named re-exports), so internal helpers stay internal.

// platform
export { sql } from "./platform";
export { env, freshdeskToken, githubToken, sourceToken } from "./platform";
export { AppError, notFound, conflict, badInput } from "./platform";
export type { AppErrorCode } from "./platform";
export { log } from "./platform";
export { upsertUser, resolveCurrentUserId } from "./platform";

// knowledge
export {
  saveKnowledgeEntry, searchKnowledge, backfillEmbeddings,
  getKnowledgeEntry, listKnowledgeEntries, updateKnowledgeEntry,
} from "./knowledge";
export type { KnowledgeInput, KnowledgeUpdateInput, SearchOptions } from "./knowledge";
export { addFeedback, listFeedback } from "./knowledge";
export type { FeedbackInput } from "./knowledge";
export {
  structuredSchema, cloudSchema, resolutionClaritySchema, learningValueSchema,
  CLOUDS, RESOLUTION_CLARITIES, LEARNING_VALUES,
} from "./knowledge";
export type { Structured } from "./knowledge";

// reference
export {
  saveReferenceDoc, getReferenceDoc, listReferenceDocs, updateReferenceDoc, searchReferenceDocs,
} from "./reference";
export type { ReferenceDocInput, ReferenceDocUpdate, ReferenceSearchOptions } from "./reference";

// work-items
export { ingestWorkItem } from "./work-items";
export type { IngestedItem } from "./work-items";
export { recordRun, estimateCostUsd } from "./work-items";
export type { RunInput } from "./work-items";

// catalog
export {
  listCustomers, addCustomer, resolveCustomerByEmail, getCustomerIdBySlug,
  setWorkItemCustomer, setObservedVersion, getCustomerName, getCustomerSlug,
} from "./catalog";
export type { CustomerInput } from "./catalog";
export { listResolutionPatterns, addResolutionPattern } from "./catalog";
export { listComponents, addComponent, resolveComponentTags } from "./catalog";
export type { AddComponentInput } from "./catalog";
export {
  getProductIdBySlug, getTeamIdBySlug, listTeams, addTeam, listProducts, addProduct, listLabels, addLabel,
} from "./catalog";

// sources
export * from "./sources/source";
export { registerSource, resolveSource } from "./sources";
export type { ResolvedSource } from "./sources";
export {
  listSourceConnections, addSourceConnection, listSourceProductMaps, addSourceProductMap,
} from "./sources";
export type { SourceConnectionInput, SourceProductMapInput } from "./sources";

// search
export { embedPassage, embedQuery, toVectorLiteral, EMBEDDING_DIM } from "./search";
export { chunkText } from "./search";

// compliance (PII redaction at the LLM boundary)
export {
  TokenMap, scrubText, redactNormalized, redactForLlm, resolveRedactionPolicy,
} from "./compliance";
export type { RedactOptions, RedactionPolicy } from "./compliance";
