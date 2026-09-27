import type {
  ComposerForm,
  TicketValidation,
  WorkItemTypeOption,
} from "@tachy/contract";
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

/** Result of a credential/connectivity check against the remote system. */
export interface SourceProbe {
  /** Who the token authenticates as, when the API reports it. */
  identity?: string;
  /** The groups this token can see — the `external_group_key` values a product map needs. */
  groups: { key: string; name: string }[];
  /**
   * Why `groups` is empty, when listing them failed. Group discovery is a
   * convenience — a token that cannot list groups (a non-admin Freshdesk agent
   * key, a narrow GitHub scope) still works for the fetches tachy actually
   * does, so this never fails the probe.
   */
  groupsNote?: string;
}

export interface WorkItemSource {
  readonly type: string;
  readonly capabilities: SourceCapabilities;
  fetchItem(externalId: string): Promise<RawWorkItem>;
  /** Cheapest authenticated call the API offers; throws when the token is bad. */
  verify?(): Promise<SourceProbe>;
  listItems(
    opts: ListOptions,
  ): Promise<{ items: RawWorkItem[]; nextCursor?: string }>;
  postNote?(
    externalId: string,
    body: string,
    opts?: { private?: boolean },
  ): Promise<void>;
  /**
   * Remove a note this system posted earlier, by its message id. Only ever
   * called for notes tachy itself wrote and can still identify.
   */
  deleteNote?(messageId: string): Promise<void>;
  /**
   * Optional PII scrub of the source-specific `raw` payload for redaction mode.
   * Only the adapter knows its payload's field shape. Must return a deep copy and
   * not mutate the input; use the shared TokenMap so tokens stay consistent with
   * the normalized-field redaction. `customerSlug` stands in for the requester's
   * name where known. Import scrubText/TokenMap from @tachy/core.
   */
  redactRaw?(raw: unknown, map: TokenMap, customerSlug: string | null): unknown;
  /** Present when people can create items in this source from tachy. */
  composer?: WorkItemComposer;
}

export interface PastedImage {
  /** The `attachment:<key>` an HTML field refers to it by. */
  key: string;
  name: string;
  bytes: Uint8Array;
}

/** An item to create, in the source's own field ids. */
export interface NewWorkItem {
  /** The source's project key: an ADO project name, a GitHub owner/repo. */
  project: string;
  type: string;
  title: string;
  /** Plain text or HTML, for sources with one description field. */
  description?: string;
  fields?: Record<string, unknown>;
  /** Applied underneath `fields`. */
  defaults?: Record<string, unknown>;
  parentId?: string;
  relatedIds?: string[];
  tags?: string[];
  images?: PastedImage[];
}

export interface CreateContext {
  sourceSlug: string;
  userId: string | null;
  /** The registered project, when there is one, for the links it records. */
  sourceProjectId?: string | null;
  /** Tachy work items this is raised from; each records it as tracked_by. */
  workItemIds?: string[];
}

/**
 * Creating items from the composer. Everything the composer and the admin's
 * form config know about a source goes through here, so a new source needs an
 * adapter and nothing else. `projectConfig` is the registered project's own
 * config, where a source keeps per-project defaults.
 */
export interface WorkItemComposer {
  types(project: string): Promise<WorkItemTypeOption[]>;
  form(
    project: string,
    type: string,
    opts: { projectConfig?: Record<string, unknown> },
  ): Promise<ComposerForm>;
  /** A team template's field values, for sources that have templates. */
  template?(
    project: string,
    team: string,
    id: string,
  ): Promise<Record<string, unknown>>;
  /** Runs the source's own rules without saving, where it can. */
  validate?(
    item: NewWorkItem,
    projectConfig?: Record<string, unknown>,
  ): Promise<TicketValidation>;
  create(
    item: NewWorkItem,
    ctx: CreateContext,
    projectConfig?: Record<string, unknown>,
  ): Promise<{ id: number | string; url: string }>;
}

export type SourceFactory = (cfg: {
  baseUrl: string;
  slug: string;
  config: Record<string, unknown>;
  /** Resolved from the credential vault; falls back to the env var when absent. */
  token?: string;
}) => WorkItemSource;
