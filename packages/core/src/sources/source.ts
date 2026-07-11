import type { TokenMap } from "../compliance/redaction";
import type { RawWorkItem } from "../types";

export type { RawMessage, RawWorkItem } from "../types";

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
  listItems(
    opts: ListOptions,
  ): Promise<{ items: RawWorkItem[]; nextCursor?: string }>;
  postNote?(
    externalId: string,
    body: string,
    opts?: { private?: boolean },
  ): Promise<void>;
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
  config: Record<string, unknown>;
}) => WorkItemSource;
