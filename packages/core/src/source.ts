// The one seam that makes tachy source-agnostic. Implement this per tracker
// (freshdesk, github, ...) and register it. No schema or core changes needed.

export interface RawMessage {
  externalId?: string;
  author?: string;
  visibility: "public" | "private" | "internal";
  direction: "incoming" | "outgoing";
  bodyText: string;            // adapter delivers plain text (HTML already stripped)
  attachments?: unknown[];
  createdAt?: string;          // ISO
}

export interface RawWorkItem {
  externalId: string;
  externalUrl?: string;
  kind: "ticket" | "issue";
  title?: string;
  status?: string;             // native status (raw); mapping is account-specific
  groupKey?: string;           // freshdesk group_id, or 'owner/repo'
  requester?: string;          // opaque source-native id (e.g. Freshdesk requester_id), not necessarily an email
  requesterEmail?: string;     // for customer auto-matching by domain; not all sources can provide this
  raw: unknown;                // full original payload (traceability)
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
  updatedSince?: string;       // ISO watermark
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
  config: Record<string, unknown>;   // non-secret connection config (e.g. github repos)
}) => WorkItemSource;
