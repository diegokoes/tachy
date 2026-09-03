export interface KnowledgeRow {
  id: string;
  work_item_id: string | null;
  product_id?: string | null;
  team_id?: string | null;
  status: string;
  superseded_by?: string | null;
  issue_summary: string | null;
  root_cause: string | null;
  resolution: string | null;
  resolution_pattern: string | null;
  component_id?: string | null;
  product_area: string | null;
  /** Whose install this was learned on. Null = general to every customer. */
  customer_id?: string | null;
  customer_slug?: string | null;
  customer_unit_slug?: string | null;
  confidence: string | null;
  cloud: string | null;
  resolution_clarity: string | null;
  hidden_fix: boolean | null;
  affected_version?: string | null;
  fixed_version?: string | null;
  symptoms: string[] | null;
  signals: string[] | null;
  tags: string[] | null;
  structured?: Record<string, unknown> | null;
  version: number;
  created_at?: string;
  updated_at?: string;
  /* Search only. `relevance`/`grade` are calibrated server-side against the
     embedding model's measured distribution; the raw signals are the inputs. */
  relevance?: number;
  grade?: string;
  rrf?: number;
  cos_sim?: number;
  fts_rank?: number;
  trgm_sim?: number;
}

export interface Feedback {
  id: string;
  user_id: string | null;
  kind: string;
  rating: number | null;
  comment: string | null;
  patch: unknown;
  created_at: string;
}

/** One kept version of a library item, from /:base/:id/revisions. */
export interface Revision {
  id: string;
  version: number;
  actor: string;
  turn_id: string | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  changed_fields: string[];
  created_at: string;
}

export interface ViewSummary {
  views: number;
  viewers: number;
  last_viewed_at: string | null;
  history: { day: string; views: number }[];
}

export interface WikiCategory {
  id: string;
  product_id: string | null;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  ordinal: number;
}

export interface WikiArticleRef {
  id: string;
  slug: string | null;
  title: string;
  status: string;
  ordinal: number;
  updated_at: string;
  stale?: number;
}

export interface WikiTocNode extends WikiCategory {
  articles: WikiArticleRef[];
  children: WikiTocNode[];
}

export interface WikiToc {
  categories: WikiTocNode[];
  uncategorised: WikiArticleRef[];
}

/**
 * One work-item field, as the server projects it. Mirrors the shape in
 * `@tachy/source-azure-devops`; the SPA cannot import that package, which pulls
 * in core.
 */
export interface FieldSpec {
  reference_name: string;
  name: string;
  required: boolean;
  allowed_values?: unknown[];
  allowed_values_truncated?: true;
  default_value?: unknown;
  type?: string;
  read_only?: true;
  is_identity?: true;
  help_text?: string;
}

export interface WorkItemSchema {
  project: string;
  type: string;
  fields: FieldSpec[];
  config_defaults: Record<string, unknown>;
}

export interface CoverageCounts {
  entries: number;
  docs: number;
  articles: number;
  reads: number;
}

export interface CoverageNode extends CoverageCounts {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  subtree: CoverageCounts;
  children: CoverageNode[];
}

export interface Coverage {
  nodes: CoverageNode[];
  unfiled: { entries: number; docs: number; articles: number };
}

export interface WikiListRow {
  product_id: string | null;
  product_slug: string | null;
  product_name: string | null;
  articles: number;
}

export interface ReferenceRow {
  id: string;
  title: string;
  /** 'wiki' = an article authored here; 'reference' = imported source material. */
  kind?: string;
  /** An article's stable address within its wiki. */
  slug?: string | null;
  categories?: WikiCategory[];
  /** What an article was composed from, and how much of it has moved since. */
  built?: {
    sources: number;
    entries: number;
    docs: number;
    changed: number;
    changedTitles: string[];
  };
  product_id?: string | null;
  team_id?: string | null;
  component_id?: string | null;
  product_area?: string | null;
  customer_id?: string | null;
  customer_slug?: string | null;
  customer_unit_slug?: string | null;
  source?: string | null;
  tags: string[] | null;
  status: string;
  version: number;
  doc_version?: string | null;
  superseded_by?: string | null;
  snippet?: string;
  body?: string;
  structured?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  relevance?: number;
  grade?: string;
  rrf?: number;
  cos_sim?: number;
  fts_rank?: number;
  trgm_sim?: number;
}

export interface ReferenceLineageRow {
  id: string;
  title: string;
  doc_version?: string | null;
  status: string;
  superseded_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface NamedRow {
  id?: string;
  slug?: string;
  name?: string;
  description?: string | null;
  aliases?: string[] | null;
  [k: string]: unknown;
}
