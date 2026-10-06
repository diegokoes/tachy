export { chunkCode } from "./chunk-code";
export { chunkSymbols, definedSymbols, fileStem } from "./symbols";
export type { CodeChunk } from "./chunk-code";
export { repoDir, listRemoteRefs, releaseBranch, removeClone } from "./git";
export type { TreeEntry, CommitSummary } from "./git";
export {
  DEFAULT_CODE_EXTENSIONS,
  REPO_INDEX_STATUSES,
  linkRepo,
  listRepos,
  getRepoBySlug,
  getRepoLine,
  repoScope,
  deleteRepo,
  sweepInterruptedIndexes,
  repoCensus,
  repoIssues,
  repoFreshness,
} from "./repos";
export type {
  RepoInput,
  RepoRow,
  RepoLine,
  RepoLineRow,
  RepoIndexStatus,
} from "./repos";
export {
  indexRepo,
  previewIndex,
  backfillCodeEmbeddings,
  backfillCodeWords,
} from "./indexer";
export type { IndexResult, LineIndexResult } from "./indexer";
export type { IndexPreview, PreviewDir, PreviewType } from "@tachy/contract";
export { fileIconOf, fileIconPath } from "./file-icons";
export { searchCode, readCodeFile } from "./search";
export type { CodeSearchOptions, ReadCodeOptions } from "./search";
export { resolveVersion, codeChangesBetween } from "./versions";
export type { ResolvedVersion, CodeChanges } from "./versions";
export { repoToken, connectionToken, tokenMaySendTo } from "./token";
export { activeReindexes } from "./jobs";
export {
  RELEASE_TAG_RE,
  releaseMinor,
  normalizeVersion,
} from "@tachy/contract";
