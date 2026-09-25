/**
 * Path segments an article slug may not take, because the wiki's own routes
 * use them. The server refuses them on write and the SPA routes on them, so the
 * list is written once. 'toc' and 'coverage' are the names those pages had
 * under /library/wiki; they stay reserved so an old link still redirects
 * instead of resolving to an article someone wrote since.
 */
export const WIKI_RESERVED_SLUGS = [
  "toc",
  "c",
  "coverage",
  "new",
  "contents",
  "gaps",
] as const;

/** The article a wiki opens on — a real article at a reserved address. */
export const MAIN_PAGE_SLUG = "main";

/**
 * What the gap sweep flags, in the order a curator should work through them:
 * material nobody has written up, then articles the material has moved past,
 * then the wiki's own housekeeping.
 */
export const WIKI_GAP_KINDS = [
  "unwritten",
  "outgrown",
  "stale",
  "wanted",
  "draft",
  "uncategorised",
] as const;
export type WikiGapKind = (typeof WIKI_GAP_KINDS)[number];

/** A component a section covers, for per-section coverage. */
export interface WikiCategoryComponent {
  slug: string;
  name: string;
}

export interface WikiCategoryRow {
  id: string;
  product_id: string | null;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  ordinal: number;
  /** The section's lead article, if one is set. */
  lead_slug: string | null;
  lead_title: string | null;
  /** Components this section covers; empty for a purely editorial section. */
  components: WikiCategoryComponent[];
}

/** Per-section coverage rolled up from the section's linked components. */
export interface WikiSectionCoverage {
  articles: number;
  gaps: number;
}

/** One hit from the in-wiki quick search (Ctrl+K), drafts included. */
export interface WikiSearchHit {
  id: string;
  slug: string | null;
  title: string;
  status: string;
  snippet: string;
}

export interface WikiArticleRef {
  id: string;
  slug: string | null;
  title: string;
  status: string;
  ordinal: number;
  updated_at: string;
  /** Sources this was composed from that have changed since it was written. */
  stale?: number;
}

export interface WikiTocNode extends WikiCategoryRow {
  articles: WikiArticleRef[];
  children: WikiTocNode[];
}

export interface WikiToc {
  categories: WikiTocNode[];
  /** Articles filed under nothing — the wiki's own measure of unfiled work. */
  uncategorised: WikiArticleRef[];
}

/** One wiki in the index: a product's, or the org-wide one with no product. */
export interface WikiListRow {
  product_id: string | null;
  product_slug: string | null;
  product_name: string | null;
  articles: number;
  /** Open gaps from the last sweep, dismissed ones left out. */
  open_gaps: number;
}

export interface WikiGapItem {
  kind: "entry" | "doc";
  id: string;
  title: string;
}
