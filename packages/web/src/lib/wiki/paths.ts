import type { WikiListRow } from "../types";

/**
 * The scope segment for the org-wide wiki. A product actually slugged
 * 'general' wins on the server, so this never shadows a real product.
 */
export const ORG_WIDE = "general";

export const scopeOf = (w: WikiListRow) => w.product_slug ?? ORG_WIDE;

export const wikiLabel = (w: WikiListRow) =>
  w.product_name ?? "General (org-wide)";

/** Every path in the section, built in one place. */
export const wikiPath = (scope: string, ...rest: string[]) =>
  ["/wiki", scope, ...rest].join("/");

/** The two pages that were renamed when the wiki left the library. */
const RENAMED: Record<string, string> = { toc: "contents", coverage: "gaps" };

export const renamedPage = (page: string): string | undefined => RENAMED[page];

/**
 * Where an old /library/wiki/… path lives. Chat history, the agent's earlier
 * replies and people's bookmarks still carry that form.
 */
export function movedWikiPath(segments: string[]): string {
  const [scope, page, ...rest] = segments.slice(2);
  if (!scope) return "/wiki";
  if (!page) return wikiPath(scope);
  return wikiPath(scope, renamedPage(page) ?? page, ...rest);
}

/**
 * A wikilink's destination, from what the server resolved it to. Articles are
 * addressed by slug within their wiki; everything else lives in the library.
 */
export function libraryItemPath(to: {
  entryId?: string | null;
  docId?: string | null;
  kind?: string | null;
  slug?: string | null;
  scope: string;
}): string | null {
  if (to.entryId) return `/library/entries/${to.entryId}`;
  if (to.kind === "wiki" && to.slug) return wikiPath(to.scope, to.slug);
  if (to.docId) return `/library/docs/${to.docId}`;
  return null;
}
