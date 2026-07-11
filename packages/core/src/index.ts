export { sql } from "./infra";
export {
  env,
  envVarName,
  freshdeskToken,
  githubToken,
  azureDevopsToken,
  sourceToken,
  sourceTokenOptional,
} from "./infra";
export { AppError, notFound, conflict, badInput, forbidden } from "./infra";
export type { AppErrorCode } from "./infra";
export { log } from "./infra";
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
} from "./access";
export type { EntryScope } from "./access";
export { upsertUser, resolveCurrentUserId } from "./access";
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
  userSoleTeamId,
} from "./access";
export type { UserRole, TeamRole, UserRow, TeamMemberRow } from "./access";
export { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./access";
export {
  AGENT_EFFORTS,
  AGENT_PROVIDERS,
  DEPLOYMENT_PROFILES,
  SETTING_KEYS,
  getSettings,
  setSetting,
  effectiveSettings,
  loadSettingsIntoEnv,
  clearSettingsCache,
} from "./config";
export type {
  SettingKey,
  SettingsMap,
  EffectiveSettings,
  SettingSource,
  DeploymentProfile,
  AgentProvider,
} from "./config";
export {
  resolveScoped,
  assertCanWriteScope,
  AGENT_CREDENTIALS,
  sourceCredentialName,
  envCredential,
  resolveCredential,
  credentialSource,
  setCredential,
  deleteCredential,
  listCredentials,
  PREF_KEYS,
  resolvePref,
  effectivePrefs,
  setPref,
  deletePref,
  listVisibleArtifacts,
  getArtifact,
  upsertArtifact,
  deleteArtifact,
} from "./config";
export type {
  Scope,
  ScopeContext,
  CredentialSource,
  CredentialMeta,
  PrefKey,
  PrefSource,
  ArtifactMeta,
  ArtifactRow,
} from "./config";
export { secretsEnabled } from "./infra";

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
  referenceDocLineage,
} from "./reference";
export type {
  ReferenceDocInput,
  ReferenceDocUpdate,
  ReferenceSearchOptions,
} from "./reference";

export { ingestWorkItem, extractAdoRefs } from "./work-items";
export type { IngestedItem } from "./work-items";
export { recordRun, estimateCostUsd } from "./analytics";
export type { RunInput } from "./analytics";

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
  embedPassages,
  embedQuery,
  toVectorLiteral,
  EMBEDDING_DIM,
} from "./search";
export { chunkText } from "./search";

export * from "./code";

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
