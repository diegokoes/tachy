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
  confidence: string | null;
  cloud: string | null;
  resolution_clarity: string | null;
  learning_value: string | null;
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
  score?: number;
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

export interface ReferenceRow {
  id: string;
  title: string;
  product_id?: string | null;
  team_id?: string | null;
  source?: string | null;
  tags: string[] | null;
  status: string;
  version: number;
  snippet?: string;
  body?: string;
  structured?: Record<string, unknown> | null;
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
