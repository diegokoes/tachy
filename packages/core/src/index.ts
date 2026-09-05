export { sql } from "./infra";
export type { Db } from "./infra";
export {
  env,
  envVarName,
  freshdeskToken,
  githubToken,
  azureDevopsToken,
  sourceToken,
  sourceTokenOptional,
  uploadDir,
} from "./infra";
export { AppError, notFound, conflict, badInput, forbidden } from "./infra";
export type { AppErrorCode } from "./infra";
export { log, runWithLogContext } from "./infra";
export type { LogLevel } from "./infra";
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
  setUserDisplayName,
  listTeamMembers,
  listMemberships,
  setTeamMember,
  userSoleTeamId,
  userTeams,
} from "./access";
export type {
  UserRole,
  TeamRole,
  UserRow,
  TeamMemberRow,
  MembershipRow,
} from "./access";
export { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./access";
export { userCensus } from "./access";
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
  SCOPES,
  resolveScoped,
  assertCanWriteScope,
  AGENT_CREDENTIALS,
  ANTHROPIC_OAUTH_CREDENTIAL,
  API_KEY_EXAMPLE,
  API_KEY_PREFIX,
  OAUTH_PREFIX,
  sourceCredentialName,
  envCredential,
  validateCredential,
  resolveCredential,
  resolveAgentAuth,
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
  getArtifactBySlug,
  upsertArtifact,
  deleteArtifact,
  artifactSpecSchema,
} from "./config";
export type {
  Scope,
  ScopeContext,
  CredentialSource,
  CredentialMeta,
  AgentAuth,
  PrefKey,
  PrefSource,
  ArtifactMeta,
  ArtifactRow,
  ArtifactSpec,
} from "./config";
export { secretsEnabled } from "./infra";

export {
  saveKnowledgeEntry,
  searchKnowledge,
  backfillEmbeddings,
  getKnowledgeEntry,
  listKnowledgeEntries,
  updateKnowledgeEntry,
  revertKnowledgeEntry,
  listEnvironments,
  listKnowledgeFacets,
} from "./knowledge";
export type {
  KnowledgeInput,
  KnowledgeUpdateInput,
  SearchOptions,
  KnowledgeListOptions,
  KnowledgeFilters,
  FacetKey,
  FacetCount,
} from "./knowledge";
export { addFeedback, listFeedback } from "./knowledge";
export {
  LIBRARY_ACTORS,
  UNKNOWN_ACTOR,
  VIEW_DEDUPE_MINUTES,
  snapshotOf,
  changedFields,
  recordRevision,
  listRevisions,
  getRevision,
  revertPatch,
  recordView,
  countView,
  viewStats,
  viewHistory,
  syncLinks,
  outboundLinks,
  backlinks,
  relinkBySlug,
  setComposedFrom,
  articleStaleness,
  coverage,
  parseWikilinks,
  LINK_KINDS,
} from "./library";
export type {
  LibraryActor,
  LibraryTarget,
  ActorRef,
  RevisionRow,
  ViewStats,
  DailyViews,
  LinkKind,
  LinkSource,
  OutboundLink,
  Backlink,
  ComposedSource,
  Staleness,
  Coverage,
  CoverageNode,
  CoverageCounts,
} from "./library";
export type { FeedbackInput } from "./knowledge";

export {
  MAIN_PAGE_SLUG,
  listWikiCategories,
  getWikiCategory,
  addWikiCategory,
  updateWikiCategory,
  deleteWikiCategory,
  wikiToc,
  articleCategories,
  setArticleCategories,
  findArticle,
  findMainPage,
  listWikis,
  draftSources,
} from "./wiki";
export type {
  WikiCategoryRow,
  WikiCategoryInput,
  WikiCategoryPatch,
  WikiArticleRef,
  WikiTocNode,
  WikiToc,
  DraftSource,
} from "./wiki";
export {
  structuredSchema,
  cloudSchema,
  resolutionClaritySchema,
  RESOLUTION_CLARITIES,
  knowledgeStatusSchema,
  referenceStatusSchema,
  referenceKindSchema,
  confidenceSchema,
  feedbackKindSchema,
  runModeSchema,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
  REFERENCE_KINDS,
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
  revertReferenceDoc,
  searchReferenceDocs,
  referenceDocLineage,
  backfillReferenceEmbeddings,
} from "./reference";
export type {
  ReferenceDocInput,
  ReferenceDocUpdate,
  ReferenceSearchOptions,
} from "./reference";

export { ingestWorkItem, extractAdoRefs } from "./work-items";
export { workItemScope, externalWorkItemScope } from "./work-items";
export type { IngestedItem } from "./work-items";
export {
  WORK_ITEM_LINK_KINDS,
  addWorkItemLink,
  listWorkItemLinks,
  deleteWorkItemLink,
  recordAdoRefs,
} from "./work-items";
export type { WorkItemLinkKind, WorkItemLinkInput } from "./work-items";
export {
  compactWorkItem,
  compactMessages,
  normalizeBody,
  parseMailDate,
  splitQuotedBlocks,
  splitPrologue,
  renderCompactScript,
  renderCompactHtml,
  splitNoteBody,
  summarizeCompaction,
  compactForLlm,
  normalizeAttachments,
  formatBytes,
  describeAttachment,
  looksStructured,
  IMAGE_MARK,
  TRANSCRIPT_MARKER,
  COMPACT_MIN_CHARS,
  COMPACT_MIN_SAVING,
} from "./work-items";
export type {
  CompactedWorkItem,
  CompactTurn,
  CompactStats,
  CompactOptions,
  CompactMeta,
  CompactAttachment,
} from "./work-items";
export { recordRun, estimateCostUsd } from "./analytics";
export type { RunInput } from "./analytics";

export {
  listCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  resolveCustomerByEmail,
  setCustomerFact,
  deleteCustomerFact,
  listCustomerFacts,
  listCustomerFactKinds,
  linkCustomerComponent,
  unlinkCustomerComponent,
  listCustomerComponents,
  getCustomerProfile,
  getCustomerIdBySlug,
  resolveCustomer,
  listCustomerUnits,
  resolveUnit,
  addCustomerUnit,
  updateCustomerUnit,
  deleteCustomerUnit,
  resolveUnitFacts,
  setWorkItemCustomer,
  setObservedVersion,
  getCustomerName,
  getCustomerSlug,
  catalogCensus,
} from "./catalog";
export type {
  CustomerInput,
  CustomerMatch,
  CustomerFactInput,
  CustomerProfile,
  ResolvedCustomer,
  CustomerUnitRow,
  CustomerUnitInput,
  CustomerUnitPatch,
  ResolvedFact,
} from "./catalog";
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
export * from "./sources/fetch";
export { registerSource, resolveSource } from "./sources";
export type { ResolvedSource } from "./sources";
export {
  listSourceConnections,
  addSourceConnection,
  deleteSourceConnection,
  sourceCensus,
} from "./sources";
export type { SourceConnectionInput } from "./sources";
export {
  SOURCE_PROJECT_ROLES,
  listSourceProjects,
  getSourceProject,
  resolveSourceProject,
  addSourceProject,
  updateSourceProject,
  deleteSourceProject,
  sourceProjectScope,
  listProjectAreaMap,
  setProjectAreaMap,
  deleteProjectAreaMap,
  resolveAreaComponent,
  resolveProjectContext,
  resolveProjectContextStrict,
  routeIngest,
  normalizeWikis,
  defaultWiki,
  matchWiki,
} from "./sources";
export type {
  SourceProjectRole,
  SourceProjectInput,
  SourceProjectPatch,
  SourceProjectRow,
  ProjectWiki,
  AreaMapInput,
  ProjectContext,
  ProjectContextQuery,
  ProjectRepoContext,
  IngestRoute,
} from "./sources";

export {
  embedPassage,
  embedPassages,
  embedQuery,
  embedQueryLiteral,
  toVectorLiteral,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  EMBEDDING_SPEC,
  EMBEDDING_MODELS,
} from "./search";
export { chunkText } from "./search";
export {
  relevance,
  grade,
  gradeOf,
  withRelevance,
  SEM_FLOOR,
  SEM_CEIL,
  GOOD,
  STRONG,
} from "./search";
export type { Grade, Ranked } from "./search";
export {
  RRF_K,
  RRF_WEIGHTS,
  CANDIDATES,
  HNSW_EF_SEARCH,
  WORD_SIM_THRESHOLD,
  clampLimit,
} from "./search";

export * from "./code";

export * from "./exports";

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

/*
 * The rest of the contract, re-exported wholesale. packages/api and the CLI
 * import only from here, so anything the contract owns but core does not pass
 * on is a rule they have to write out by hand — which is how two copies of it
 * come to exist and drift. test/contract-reach.test.ts holds this complete.
 */
export {
  CLOUD_RE,
  CLOUD_HINT,
  SLUG_RE,
  slugify,
  WIKILINK_RE,
  parseWikilink,
  DEFAULT_SHEET,
  stripSheetChars,
  stripFilenameChars,
  sheetName,
  columnHeading,
  fieldName,
  columnKeys,
  ARTIFACT_UTILITIES,
} from "@tachy/contract";
