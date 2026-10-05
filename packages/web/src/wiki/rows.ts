import type {
  Coverage,
  WikiCategoryRow,
  WikiGapItem,
  WikiGapKind,
} from "@tachy/contract";

export type WikiCategory = WikiCategoryRow;

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
