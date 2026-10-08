import { entryText, excerpt, type Seg } from "./matching";
import { fmtDate } from "../dates.svelte";
import type { KnowledgeRow } from "../knowledge/rows";
import type { ReferenceRow } from "../reference/rows";

/**
 * One row of the library list, whichever table it came from. The view renders
 * this shape and nothing else, so the two mappings below are the only place
 * that knows a knowledge entry from a reference doc.
 */
export type Item = {
  kind: "entry" | "doc" | "article";
  id: string;
  /** Articles are addressed by slug within a wiki, not by id. */
  slug?: string;
  productId?: string;
  title: string;
  status: string;
  /** Query-centred excerpt of the matching chunk, split on the hits. */
  snippet?: Seg[];
  /** Top-right of the card: doc version, or an entry's version span. */
  version?: string;
  updated?: string;
  tags: string[];
  /** Set when the item describes one customer's install rather than the product. */
  customer?: string | null;
  /** Server-calibrated 0-1 match strength - what the gauge draws. */
  relevance?: number;
  /** "strong" | "good" | "weak", from the same calibration. */
  grade?: string;
  sortAt: number;
};

const at = (d?: string) => (d ? Date.parse(d) || 0 : 0);
/** Gauge width for a relevance score, floored so a weak hit still shows. */
export const fill = (v: number) => Math.max(3, v * 100);

function versionSpan(row: KnowledgeRow) {
  if (row.affected_version && row.fixed_version)
    return `${row.affected_version} → ${row.fixed_version}`;
  if (row.affected_version) return row.affected_version;
  if (row.fixed_version) return `fixed ${row.fixed_version}`;
  return undefined;
}

export function toEntry(row: KnowledgeRow, query: string): Item {
  const text = entryText(
    [row.root_cause, row.resolution, (row.signals ?? []).join(" · ")],
    query,
  );
  return {
    kind: "entry",
    id: row.id,
    title: row.issue_summary ?? "(no summary)",
    status: row.status,
    snippet: text ? excerpt(text, query) : undefined,
    version: versionSpan(row),
    updated: fmtDate(row.updated_at ?? row.created_at),
    tags: (row.tags ?? []).slice(0, 5),
    customer: row.customer_slug,
    relevance: row.relevance,
    grade: row.grade,
    sortAt: at(row.updated_at ?? row.created_at),
  };
}

export function toDoc(row: ReferenceRow, query: string): Item {
  return {
    kind: row.kind === "wiki" ? "article" : "doc",
    id: row.id,
    slug: row.slug ?? undefined,
    productId: row.product_id ?? undefined,
    title: row.title,
    status: row.status,
    snippet: row.snippet ? excerpt(row.snippet, query) : undefined,
    version: row.doc_version ? `v${row.doc_version}` : undefined,
    updated: fmtDate(row.updated_at ?? row.created_at),
    tags: (row.tags ?? []).slice(0, 6),
    customer: row.customer_slug,
    relevance: row.relevance,
    grade: row.grade,
    sortAt: at(row.updated_at ?? row.created_at),
  };
}
