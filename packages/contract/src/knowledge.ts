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
  /** Approved or deprecated: the statuses searchKnowledge returns. */
  searchable: number;
}
