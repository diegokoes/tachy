export { sql } from "./infra";
export type { Db } from "./infra";
export {
  env,
  envVarName,
  agentHome,
  freshdeskToken,
  githubToken,
  azureDevopsToken,
  sourceToken,
  sourceTokenOptional,
  sweepUploads,
  saveUpload,
  readUpload,
  uploadRef,
  parseUploadRef,
  uploadTtlMs,
} from "./infra";
export {
  AppError,
  notFound,
  conflict,
  badInput,
  forbidden,
  unavailable,
} from "./infra";
export { schemaStampStatus, type SchemaStampStatus } from "./infra";
export { inBackground, backgroundSettled } from "./infra";
export type { AppErrorCode } from "./infra";
export { log, logContext, runWithLogContext } from "./infra";
export type { LogLevel } from "./infra";
export { secretsEnabled, vaultKeys, keyId } from "./infra";
export { ISSUE_ITEMS, issueList, issueFlag, type IssueList } from "./infra";
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
  setUserFlags,
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
export { userCensus, userIssues } from "./access";
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
  scopesOf,
  resolveScoped,
  upsertScoped,
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
  CredentialScope,
  CredentialSource,
  CredentialMeta,
  AgentAuth,
  PrefKey,
  PrefSource,
  ArtifactMeta,
  ArtifactRow,
  ArtifactSpec,
} from "./config";
export { vaultState, rotateVaultKey } from "./config";

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
  knowledgeCensus,
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
export type { FeedbackInput } from "./knowledge";
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
  renameWikilinks,
  LINK_KINDS,
  sniffImage,
  saveAsset,
  getAsset,
  libraryEngagementCensus,
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
  SavedAsset,
  LibraryEngagement,
} from "./library";

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
  GAP_THRESHOLD,
  findWikiGaps,
  sweepWikiGaps,
  listWikiGaps,
  dismissWikiGap,
} from "./wiki";
export type {
  WikiCategoryRow,
  WikiCategoryInput,
  WikiCategoryPatch,
  WikiArticleRef,
  WikiTocNode,
  WikiToc,
  DraftSource,
  WikiGapItem,
  WikiGapFinding,
  WikiGapRow,
  SweepResult,
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
export {
  recordRun,
  estimateCostUsd,
  agentUsageCensus,
  toolUsageCensus,
  countToolCall,
  recordToolCall,
} from "./analytics";
export type { AgentUsage, ToolUsage, ToolCallOutcome } from "./analytics";
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
  catalogIssues,
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
  listComponentTree,
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

export {
  SOURCE_TIMEOUT_MS,
  sourceFetch,
  fetchUntrustedUrl,
  stripHtml,
  SOURCE_CALL_ORIGINS,
  setSourceOrigin,
  recordSourceCall,
  countSourceCall,
  sourceTrafficCensus,
  syncSource,
} from "./sources";
export type {
  RawMessage,
  RawWorkItem,
  SourceCapabilities,
  ListOptions,
  SourceProbe,
  WorkItemSource,
  SourceFactory,
  SourceCallOrigin,
  SourceCallOutcome,
  SourceTraffic,
} from "./sources";
export { registerSource, resolveSource } from "./sources";
export type { ResolvedSource } from "./sources";
export {
  listSourceConnections,
  addSourceConnection,
  deleteSourceConnection,
  sourceCensus,
  sourceIssues,
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
  setEmbedBackend,
  startEmbedHost,
  EmbedQueue,
  EmbedderUnavailable,
  toVectorLiteral,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  EMBEDDING_SPEC,
  EMBEDDING_MODELS,
} from "./search";
export { chunkText } from "./search";
export type {
  EmbedBackend,
  EmbedHost,
  EmbedKind,
  EmbedPriority,
  EmbedQueueDepth,
} from "./search";
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
  scrubStrings,
  scrubbableCopy,
  customerStandIn,
  scrubKnownNames,
  scrubDeep,
  redactNormalized,
  redactForLlm,
  resolveRedactionPolicy,
  globalRedactionEnabled,
  sweepTranscripts,
  rollUpUsage,
  sweepOrphanAssets,
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
  MAX_PAGE,
  SLUG_RE,
  CATALOG_SLUG_RE,
  CATALOG_SLUG_HINT,
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
  WIKI_RESERVED_SLUGS,
  WIKI_GAP_KINDS,
  LIBRARY_ASSET_TYPES,
  MAX_ASSET_BYTES,
  assetPath,
  ASSET_SRC_RE,
} from "@tachy/contract";
export type {
  WikiGapKind,
  LibraryAssetType,
  WikiListRow,
  AdoFieldType,
  FieldSpec,
  WorkItemSchema,
  CatalogCensus,
  UserCensus,
  SourceCensus,
  SourceConnectionRow,
  KnowledgeCensus,
} from "@tachy/contract";

// Owned by the contract, because the admin jobs form offers them and the API
// validates them.
export {
  JOB_TRIGGERS,
  JOB_STATUSES,
  JOB_RESOURCE_CLASSES,
  JOB_OVERLAP,
  JOB_MISSED,
  JOB_NOTIFY,
  JOB_CLASS_CHAT_SLOTS,
  JOB_FINISHED,
  parseDuration,
} from "@tachy/contract";
export type {
  JobTrigger,
  JobStatus,
  JobResourceClass,
  JobOverlap,
  JobMissed,
  JobNotify,
} from "@tachy/contract";
export * from "./jobs";
export * from "./testing";
