import { api } from "../api";
import type { WikiListRow } from "../types";
import { ORG_WIDE, scopeOf } from "./paths";

/**
 * Every wiki, for the switcher. Shared by the section and whichever page is
 * showing, so a write that changes a gap count can refresh the one list.
 */
export const wikis = $state({
  rows: [] as WikiListRow[],
  loaded: false,
});

export async function loadWikis(): Promise<void> {
  try {
    wikis.rows = await api.get<WikiListRow[]>("/library/wiki");
  } catch {
    wikis.rows = [];
  }
  wikis.loaded = true;
}

const LAST_SCOPE = "tachy-wiki-scope";

/** Per browser, and only a convenience: losing it just lands somewhere else. */
export function rememberScope(scope: string): void {
  try {
    localStorage.setItem(LAST_SCOPE, scope);
  } catch {
    /* private window or blocked storage */
  }
}

/**
 * Where /wiki opens: the wiki you were last in, else the one with the most
 * written, else the org-wide one.
 */
export function landingScope(): string {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_SCOPE);
  } catch {
    last = null;
  }
  if (last && wikis.rows.some((w) => scopeOf(w) === last)) return last;
  const fullest = [...wikis.rows].sort((a, b) => b.articles - a.articles)[0];
  return fullest?.articles ? scopeOf(fullest) : ORG_WIDE;
}

export interface ArticleSeed {
  title?: string;
  component?: string;
}

/**
 * What a new article starts from when something other than a blank page asked
 * for it — a gap naming the component it is about. Taken once by the form, so
 * the next "new article" starts blank again.
 */
let seed: ArticleSeed | null = null;

export function seedArticle(next: ArticleSeed): void {
  seed = next;
}

export function takeSeed(): ArticleSeed | null {
  const s = seed;
  seed = null;
  return s;
}
