export const REPO_INDEX_STATUSES = [
  "idle",
  "cloning",
  "indexing",
  "ready",
  "error",
] as const;
export type RepoIndexStatus = (typeof REPO_INDEX_STATUSES)[number];

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
