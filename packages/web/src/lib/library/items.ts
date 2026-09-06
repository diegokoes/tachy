import { entryText, excerpt, type Seg } from "./matching";
import { fmtDate } from "../dates";
import type { KnowledgeRow, ReferenceRow } from "../types";

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
  /** Server-calibrated 0-1 match strength — what the gauge draws. */
  relevance?: number;
  /** "strong" | "good" | "weak", from the same calibration. */
  grade?: string;
  sortAt: number;
};

const at = (d?: string) => (d ? Date.parse(d) || 0 : 0);
/** Gauge width for a relevance score, floored so a weak hit still shows. */
export const fill = (v: number) => Math.max(3, v * 100);

function versionSpan(r: KnowledgeRow) {
  if (r.affected_version && r.fixed_version)
    return `${r.affected_version} → ${r.fixed_version}`;
  if (r.affected_version) return r.affected_version;
  if (r.fixed_version) return `fixed ${r.fixed_version}`;
  return undefined;
}

export function toEntry(r: KnowledgeRow, query: string): Item {
  const text = entryText(
    [r.root_cause, r.resolution, (r.signals ?? []).join(" · ")],
    query,
  );
  return {
    kind: "entry",
    id: r.id,
    title: r.issue_summary ?? "(no summary)",
    status: r.status,
    snippet: text ? excerpt(text, query) : undefined,
    version: versionSpan(r),
    updated: fmtDate(r.updated_at ?? r.created_at),
    tags: (r.tags ?? []).slice(0, 5),
    customer: r.customer_slug,
    relevance: r.relevance,
    grade: r.grade,
    sortAt: at(r.updated_at ?? r.created_at),
  };
}

export function toDoc(r: ReferenceRow, query: string): Item {
  return {
    kind: r.kind === "wiki" ? "article" : "doc",
    id: r.id,
    slug: r.slug ?? undefined,
    productId: r.product_id ?? undefined,
    title: r.title,
    status: r.status,
    snippet: r.snippet ? excerpt(r.snippet, query) : undefined,
    version: r.doc_version ? `v${r.doc_version}` : undefined,
    updated: fmtDate(r.updated_at ?? r.created_at),
    tags: (r.tags ?? []).slice(0, 6),
    customer: r.customer_slug,
    relevance: r.relevance,
    grade: r.grade,
    sortAt: at(r.updated_at ?? r.created_at),
  };
}
