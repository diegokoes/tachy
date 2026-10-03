/**
 * What the indexer reads when a repo names no extensions of its own.
 *
 * Here rather than in the indexer because both sides have to agree on it: the
 * admin form offers this list, and the indexer applies it. A repo's
 * `config.include_extensions` replaces this wholesale rather than adding to it.
 */
export const DEFAULT_CODE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "cs",
  "java",
  "kt",
  "go",
  "rs",
  "rb",
  "php",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "swift",
  "scala",
  "sql",
  "sh",
  "ps1",
  "yaml",
  "yml",
  "json",
  "svelte",
  "vue",
  "md",
  "graphql",
  "proto",
] as const;

export const REPO_INDEX_STATUSES = [
  "idle",
  "cloning",
  "indexing",
  "ready",
  "error",
] as const;
export type RepoIndexStatus = (typeof REPO_INDEX_STATUSES)[number];

/**
 * A release tag: `v1.51.32` or `1.51.32`, with no pre-release suffix. RC and
 * SNAPSHOT tags share the prefix and are not releases a customer runs.
 */
export const RELEASE_TAG_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

const VERSION_RE = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/;

/** `1.51.32` for `v1.51.32`, `1.51` for `1.51`; null when it is no version. */
export function normalizeVersion(version: string): string | null {
  const m = VERSION_RE.exec(version.trim());
  if (!m) return null;
  const minor = `${Number(m[1])}.${Number(m[2])}`;
  return m[3] === undefined ? minor : `${minor}.${Number(m[3])}`;
}

/** The release line a version belongs to: `1.51` for `v1.51.32`. */
export function releaseMinor(version: string): string | null {
  const v = normalizeVersion(version);
  return v && v.split(".").slice(0, 2).join(".");
}

export interface RepoLineRow {
  id: string;
  ref: string;
  version_label: string | null;
  index_status: RepoIndexStatus;
  indexed_commit: string | null;
  indexing_commit: string | null;
  index_error: string | null;
  file_count: number;
  chunk_count: number;
  last_indexed_at: string | null;
}

/** What a repo's default line would index under a proposed config. */
export interface IndexPreview {
  ref: string;
  commit: string;
  files_total: number;
  files_admitted: number;
  /** Every directory, with the files under it at any depth. */
  dirs: PreviewDir[];
  /** Every extension outside the always-skipped directories, most files first. */
  types: PreviewType[];
}

export interface PreviewDir {
  path: string;
  files: number;
  admitted: number;
  /** Under node_modules, vendor and the like, which are never indexed. */
  skipped: boolean;
}

export interface PreviewType {
  /** Empty for files with no extension. */
  ext: string;
  files: number;
  admitted: number;
  /** Never indexable, whatever the config says. */
  binary: boolean;
  icon: string;
  icon_light: string | null;
}

/** A ref the remote offers, from `git ls-remote`. */
export interface RemoteRef {
  name: string;
  kind: "branch" | "tag";
}

/** A repo's reindex while it waits or runs, for the repos list to follow. */
export interface RepoIndexRun {
  id: string;
  status: "queued" | "running";
  /** The one line it indexes; null for all of them. */
  line: string | null;
  progress: number | null;
  progress_note: string | null;
  queued_at: string;
}

export interface RepoRow {
  id: string;
  slug: string;
  url: string;
  product_id: string | null;
  product_slug: string | null;
  source_slug: string | null;
  source_project_id: string | null;
  project_key: string | null;
  component_id: string | null;
  component_slug: string | null;
  customer_id: string | null;
  customer_slug: string | null;
  default_branch: string;
  config: Record<string, unknown>;
  index_status: RepoIndexStatus;
  indexed_commit: string | null;
  index_error: string | null;
  file_count: number;
  chunk_count: number;
  last_indexed_at: string | null;
  created_at: string;
  /** Every tracked line, the default first. The index fields above are the default line's. */
  lines: RepoLineRow[];
}

export interface RepoCensus {
  repos: number;
  failing: number;
  ready: number;
  working: number;
  idle: number;
  no_component: number;
  no_project: number;
  never_indexed: number;
  files: number;
  chunks: number;
  oldest_indexed_at: string | null;
}
