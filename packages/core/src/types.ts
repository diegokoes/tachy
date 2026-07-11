// Shared shapes used by both `sources/` and `compliance/` — hoisted here so
// neither folder has to import from the other.

export interface RawMessage {
  externalId?: string;
  author?: string;
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
  requester?: string;
  requesterEmail?: string;
  raw: unknown;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  messages: RawMessage[];
}
