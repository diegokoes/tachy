/** The CHECK on knowledge_entries.title in db/schema.sql holds the same number. */
export const MAX_ENTRY_TITLE_CHARS = 80;

/**
 * Whether `value` can be kept as one of an entry's related links: a full http
 * or https address, with no credentials in it, since every reader sees it.
 */
export function isRelatedLink(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return !url.username && !url.password;
}

export const RELATED_LINK_HINT =
  "a related link must be a full http or https address, without credentials";

export interface KnowledgeCensus {
  entries: number;
  entries_no_component: number;
  entries_no_product: number;
  by_status: Record<string, number>;
}

/** What has gone stale in the approved library, and what is waiting on a review. */
export interface KnowledgeStale {
  /** Drafts by how long they have waited, youngest first. */
  drafts: { age: "week" | "month" | "quarter" | "older"; n: number }[];
  /** Approved entries nobody has updated in a year. */
  untouched: number;
  /** Approved entries nobody has read in 90 days. */
  unread: number;
  /** Approved entries whose own author rated them low-confidence or unclear. */
  doubtful: number;
  /** The lowest-rated entries, most-read first among equals. */
  weakest: {
    id: string;
    title: string;
    rating: number;
    ratings: number;
    reads: number;
  }[];
}

/** One component's filed entries, and how many of them search can return. */
export interface ComponentKnowledge {
  component_id: string;
  entries: number;
  /** In one of SEARCHED_ENTRY_STATUSES. */
  searchable: number;
}
