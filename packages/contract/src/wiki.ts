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
