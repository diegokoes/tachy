export { sql } from "./db";
export { env, freshdeskToken, githubToken, sourceToken } from "./env";
export * from "./source";
export { registerSource, resolveSource } from "./registry";
export type { ResolvedSource } from "./registry";
export { ingestWorkItem } from "./services/ingest";
export type { IngestedItem } from "./services/ingest";
export {
  saveKnowledgeEntry, searchKnowledge, backfillEmbeddings,
  getKnowledgeEntry, listKnowledgeEntries, updateKnowledgeEntry,
} from "./services/knowledge";
export type { KnowledgeInput, KnowledgeUpdateInput, SearchOptions } from "./services/knowledge";
export { upsertUser, resolveCurrentUserId } from "./services/users";
export { addFeedback, listFeedback } from "./services/feedback";
export type { FeedbackInput } from "./services/feedback";
export { recordRun } from "./services/runs";
export type { RunInput } from "./services/runs";
export { embedPassage, embedQuery, toVectorLiteral, EMBEDDING_DIM } from "./embeddings";
export {
  listCustomers, addCustomer, resolveCustomerByEmail, getCustomerIdBySlug,
  setWorkItemCustomer, setObservedVersion, getCustomerName,
} from "./services/customers";
export type { CustomerInput } from "./services/customers";
export { listResolutionPatterns, addResolutionPattern } from "./services/resolution-patterns";
export { listComponents, addComponent } from "./services/components";
export type { AddComponentInput } from "./services/components";
export { getProductIdBySlug, listTeams, addTeam, listProducts, addProduct } from "./services/products";
export {
  listSourceConnections, addSourceConnection,
  listSourceProductMaps, addSourceProductMap,
} from "./services/sources";
export type { SourceConnectionInput, SourceProductMapInput } from "./services/sources";
