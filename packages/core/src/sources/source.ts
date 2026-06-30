// Implement per source (freshdesk, github, …) and register it; no schema changes needed.

export interface RawMessage {
  externalId?: string;
  author?: string;
  visibility: "public" | "private" | "internal";
  direction: "incoming" | "outgoing";
  bodyText: string;            // adapter delivers plain text (HTML already stripped)
  attachments?: unknown[];
  createdAt?: string;
}

export interface RawWorkItem {
  externalId: string;
  externalUrl?: string;
  kind: "ticket" | "issue";
  title?: string;
  status?: string;             // raw; account-specific mapping
  groupKey?: string;           // freshdesk group_id, or 'owner/repo'
  requester?: string;          // source-native id, not necessarily an email
  requesterEmail?: string;     // for customer auto-matching by email domain
  raw: unknown;                // full source payload
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  messages: RawMessage[];      // empty on list/sync; populated by fetchItem
}

export interface SourceCapabilities {
  postNote: boolean;
  incrementalSync: boolean;
}

export interface ListOptions {
  groupKey?: string;
  status?: string;
  updatedSince?: string;
  cursor?: string;
}

export interface WorkItemSource {
  readonly type: string;
  readonly capabilities: SourceCapabilities;
  fetchItem(externalId: string): Promise<RawWorkItem>;
  listItems(opts: ListOptions): Promise<{ items: RawWorkItem[]; nextCursor?: string }>;
  postNote?(externalId: string, body: string, opts?: { private?: boolean }): Promise<void>;
}

export type SourceFactory = (cfg: {
  baseUrl: string;
  slug: string;
  config: Record<string, unknown>;   // non-secret (e.g. github repos list)
}) => WorkItemSource;
