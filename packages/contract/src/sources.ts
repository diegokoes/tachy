export interface SourceConnectionRow {
  id: string;
  source_type: string;
  slug: string;
  base_url: string | null;
  config: Record<string, unknown> | null;
}

export interface SourceCensus {
  connections: number;
  projects: number;
  with_product: number;
  without_product: number;
  projects_no_wiki: number;
  projects_for_customer: number;
  never_synced: number;
  by_type: Record<string, number>;
}

export interface SourceTraffic {
  days: number;
  /** One row per connection that had any traffic in the window. */
  connections: {
    slug: string;
    source_type: string;
    agent: number;
    sync: number;
    app: number;
    rate_limited: number;
    auth_failures: number;
    /** Most recent day the far end refused the credentials, if any. */
    last_auth_failure: string | null;
  }[];
  /** Calls per day across every connection, oldest first, gaps filled. */
  per_day: {
    day: string;
    agent: number;
    sync: number;
    app: number;
    rate_limited: number;
    auth_failures: number;
  }[];
}

/**
 * When a thing that is kept in step with somewhere else last was: a source
 * synced, a repo indexed, a bucket sent a batch. `last_at` is null for one
 * that never has been.
 */
export interface Freshness {
  kind: "source" | "repo" | "bucket";
  key: string;
  label: string;
  last_at: string | null;
  /** What the last attempt failed with, when it did. */
  error: string | null;
}
