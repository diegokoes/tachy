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
  // Search only. `relevance`/`grade` are calibrated server-side against the
  // embedding model's measured distribution; the raw signals are the inputs.
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
