import type {
  Coverage,
  WikiCategoryRow,
  WikiGapItem,
  WikiGapKind,
} from "@tachy/contract";

export type {
  Coverage,
  CoverageCounts,
  CoverageNode,
  FieldSpec,
  WikiArticleRef,
  WikiCategoryComponent,
  WikiGapItem,
  WikiListRow,
  WikiSearchHit,
  WikiToc,
  WikiTocNode,
  WorkItemSchema,
} from "@tachy/contract";
export type WikiCategory = WikiCategoryRow;

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

export interface WikiGap {
  id: string;
  product_id: string | null;
  kind: WikiGapKind;
  key: string;
  subject: string;
  score: number;
  evidence: {
    component?: string | null;
    slug?: string;
    entries?: number;
    docs?: number;
    items?: WikiGapItem[];
    titles?: string[];
    pages?: number;
    since?: string;
    updated_at?: string;
  };
  first_seen_at: string;
  last_seen_at: string;
  dismissed_at: string | null;
  dismissed_score: number | null;
}

export interface WikiGaps {
  gaps: WikiGap[];
  coverage: Coverage | null;
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
