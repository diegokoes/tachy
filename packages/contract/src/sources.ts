export interface SourceCensus {
  connections: number;
  projects: number;
  knowledge: number;
  trackers: number;
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
  per_day: { day: string; agent: number; sync: number; app: number }[];
}
