// Implement per source (freshdesk, github, …) and register it; no schema changes needed.

import type { TokenMap } from "../compliance/redaction";

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
  /**
   * Optional PII scrub of the source-specific `raw` payload for redaction mode.
   * Only the adapter knows its payload's field shape. Must return a deep copy and
   * not mutate the input; use the shared TokenMap so tokens stay consistent with
   * the normalized-field redaction. `customerSlug` stands in for the requester's
   * name where known. Import scrubText/TokenMap from @tachy/core.
   */
  redactRaw?(raw: unknown, map: TokenMap, customerSlug: string | null): unknown;
}

export type SourceFactory = (cfg: {
  baseUrl: string;
  slug: string;
  config: Record<string, unknown>;   // non-secret (e.g. github repos list)
}) => WorkItemSource;
