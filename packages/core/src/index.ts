export { sql } from "./platform";
export { env, freshdeskToken, githubToken, sourceToken } from "./platform";
export { AppError, notFound, conflict, badInput, forbidden } from "./platform";
export type { AppErrorCode } from "./platform";
export {
  isGlobalAdmin,
  teamAdminTeams,
  isAnyTeamAdmin,
  canEditScope,
  canManageTeam,
  canManageTeamBySlug,
  assertCanEditScope,
  assertCanManageTeamBySlug,
  assertAnyTeamAdmin,
  assertGlobalAdmin,
  clearPermissionCache,
} from "./platform";
export type { EntryScope } from "./platform";
export { log } from "./platform";
export { upsertUser, resolveCurrentUserId } from "./platform";
export {
  USER_ROLES,
  TEAM_ROLES,
  countAdmins,
  listUsers,
  createUser,
  getUserByEmail,
  setUserRole,
  setUserPassword,
  setUserDisabled,
  listTeamMembers,
  setTeamMember,
} from "./platform";
export type { UserRole, TeamRole, UserRow, TeamMemberRow } from "./platform";
export { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./platform";
export {
  AGENT_EFFORTS,
  DEPLOYMENT_PROFILES,
  SETTING_KEYS,
  getSettings,
  setSetting,
  effectiveSettings,
  loadSettingsIntoEnv,
  clearSettingsCache,
} from "./platform";
export type {
  SettingKey,
  SettingsMap,
  EffectiveSettings,
  SettingSource,
  DeploymentProfile,
} from "./platform";

export {
  saveKnowledgeEntry,
  searchKnowledge,
  backfillEmbeddings,
  getKnowledgeEntry,
  listKnowledgeEntries,
  updateKnowledgeEntry,
  listEnvironments,
} from "./knowledge";
export type {
  KnowledgeInput,
  KnowledgeUpdateInput,
  SearchOptions,
} from "./knowledge";
export { addFeedback, listFeedback } from "./knowledge";
export type { FeedbackInput } from "./knowledge";
export {
  structuredSchema,
  cloudSchema,
  resolutionClaritySchema,
  learningValueSchema,
  RESOLUTION_CLARITIES,
  LEARNING_VALUES,
  knowledgeStatusSchema,
  referenceStatusSchema,
  confidenceSchema,
  feedbackKindSchema,
  runModeSchema,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
  CONFIDENCES,
  FEEDBACK_KINDS,
  RUN_MODES,
} from "./knowledge";
export type { Structured } from "./knowledge";

export {
  saveReferenceDoc,
  getReferenceDoc,
  listReferenceDocs,
  updateReferenceDoc,
  searchReferenceDocs,
} from "./reference";
export type {
  ReferenceDocInput,
  ReferenceDocUpdate,
  ReferenceSearchOptions,
} from "./reference";

export { ingestWorkItem } from "./work-items";
export type { IngestedItem } from "./work-items";
export { recordRun, estimateCostUsd } from "./work-items";
export type { RunInput } from "./work-items";

export {
  listCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  resolveCustomerByEmail,
  getCustomerIdBySlug,
  setWorkItemCustomer,
  setObservedVersion,
  getCustomerName,
  getCustomerSlug,
} from "./catalog";
export type { CustomerInput } from "./catalog";
export {
  listResolutionPatterns,
  addResolutionPattern,
  deleteResolutionPattern,
  resolutionPatternRenameImpact,
  renameResolutionPattern,
} from "./catalog";
export {
  listComponents,
  addComponent,
  updateComponent,
  deleteComponent,
  componentRenameImpact,
  renameComponent,
  resolveComponentTags,
  resolveComponentStrict,
  resolveComponentFilter,
  getComponentPath,
} from "./catalog";
export type { AddComponentInput, ResolvedComponent } from "./catalog";
export {
  getProductIdBySlug,
  getTeamIdBySlug,
  listTeams,
  addTeam,
  updateTeam,
  deleteTeam,
  listProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  listLabels,
  addLabel,
  updateLabel,
  deleteLabel,
  labelRenameImpact,
  renameLabel,
} from "./catalog";

export * from "./sources/source";
export { registerSource, resolveSource } from "./sources";
export type { ResolvedSource } from "./sources";
export {
  listSourceConnections,
  addSourceConnection,
  listSourceProductMaps,
  addSourceProductMap,
  deleteSourceProductMap,
} from "./sources";
export type { SourceConnectionInput, SourceProductMapInput } from "./sources";

export {
  embedPassage,
  embedQuery,
  toVectorLiteral,
  EMBEDDING_DIM,
} from "./search";
export { chunkText } from "./search";

export {
  TokenMap,
  scrubText,
  scrubKnownNames,
  scrubDeep,
  redactNormalized,
  redactForLlm,
  resolveRedactionPolicy,
  globalRedactionEnabled,
} from "./compliance";
export type { RedactOptions, RedactionPolicy } from "./compliance";
