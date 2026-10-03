import type {
  AgentUsage,
  CatalogCensus,
  KnowledgeCensus,
  LibraryEngagement,
  RepoCensus,
  SourceCensus,
  SourceTraffic,
  ToolUsage,
  UserCensus,
} from "@tachy/contract";

/**
 * `GET /overview` - the whole admin index in one request. `counts` and `warn`
 * badge the rail; `detail` is what the three overview panels render from.
 */
export type Census = {
  counts: Record<string, number>;
  warn: Record<string, number>;
  detail: {
    sources: SourceCensus & { untokened: number };
    repos: RepoCensus;
    catalog: CatalogCensus;
    users: UserCensus;
    knowledge: KnowledgeCensus;
  };
};

/**
 * `GET /overview/activity` - what the deployment has been doing rather than
 * what it holds. The two lists that name people arrive only for an app admin.
 */
export type Activity = {
  usage: AgentUsage;
  tools: ToolUsage;
  traffic: SourceTraffic;
  library: LibraryEngagement;
};

/** `GET /overview/issues` - per issue key, how many and the first few by name. */
export type Issues = Record<
  string,
  { n: number; items: { key: string; label: string }[] }
>;
