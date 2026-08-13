// Shared shapes used by both `sources/` and `compliance/` — hoisted here so
// neither folder has to import from the other.

export interface RawMessage {
  externalId?: string;
  author?: string;
  /** Human-readable sender, when the source can name one. Display only. */
  authorLabel?: string;
  /** Set by the source for machine-generated mail (SLA reminders, autoresponders). */
  automated?: boolean;
  visibility: "public" | "private" | "internal";
  direction: "incoming" | "outgoing";
  bodyText: string;
  attachments?: unknown[];
  createdAt?: string;
}

export interface RawWorkItem {
  externalId: string;
  externalUrl?: string;
  kind: "ticket" | "issue" | "work_item";
  title?: string;
  status?: string;
  groupKey?: string;
  /** Source-native area/category path, e.g. Azure DevOps `System.AreaPath`. */
  areaPath?: string;
  requester?: string;
  requesterEmail?: string;
  raw: unknown;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  messages: RawMessage[];
}
