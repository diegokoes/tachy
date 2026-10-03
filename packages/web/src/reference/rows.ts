import type { WikiCategory } from "../wiki/rows";

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
