// A work item as its source hands it over, before ingest. `sources/` produces
// this shape and `compliance/` scrubs it, so it lives with neither.

/**
 * A file on a message, as its source lists it. It carries no address: a
 * source's download URLs are signed and expire, so one is asked for when the
 * file is opened (`WorkItemSource.openAttachment`).
 */
export interface RawAttachment {
  /** The source's own id for it. */
  id: string;
  name: string;
  /** What the source says it is. Never trusted for what the bytes are. */
  contentType?: string;
  sizeBytes?: number;
  /** Placed in the message's body, as a pasted screenshot is. */
  inline?: boolean;
}

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
  attachments?: RawAttachment[];
  createdAt?: string;
}

/**
 * Something that happened to an item besides a message: a field that changed,
 * a moment the source reports, a link added.
 */
export interface RawEvent {
  /** The same however often the change is read, and unique within the item. */
  externalId: string;
  occurredAt: string;
  /** Who did it, as the source names them. */
  actor?: string;
  /**
   * What changed: `status`, `assignee`, `group`, `priority`, `type`, `link`,
   * `created`, or the source's own name for anything else.
   */
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
}

/** A source's own record of the customer an item belongs to. */
export interface RawCustomerRecord {
  name?: string;
  record: Record<string, unknown>;
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
  /**
   * Who it is assigned to, as the source names them. The same spelling from a
   * listing and from a fetch: a value that differs reads as a reassignment.
   */
  assignee?: string;
  priority?: string;
  /** The source's own type for it: a Freshdesk ticket type, an ADO work item type. */
  itemType?: string;
  requester?: string;
  requesterEmail?: string;
  /**
   * The requester's display name, when the source knows it. Redaction needs it:
   * `requester` is an opaque account id on most sources, and a name that is
   * never declared is a name the scrubber cannot find in the message bodies.
   */
  requesterName?: string;
  /**
   * Display names of people the source can name for this item beyond its
   * authors - the agent directory, say. Colleagues are discussed far more often
   * than they post ("Alejandro is on holiday"), and a name nothing declares is
   * a name redaction cannot find. Used for redaction only; never persisted.
   */
  knownPeople?: string[];
  raw: unknown;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  /**
   * It came from a listing: `messages` is empty because none were read, and
   * `raw` holds only what a listing returns. Unset, the item was read whole.
   */
  listed?: true;
  messages: RawMessage[];
  /**
   * What the source itself records as having happened. Kept with the item,
   * and sent to no model: it runs long and names people.
   */
  events?: RawEvent[];
  /**
   * `events` holds every field change the item has had, so none is inferred
   * from two reads differing.
   */
  historyComplete?: true;
  /** The source's id for its record of the customer: a Freshdesk company id. */
  customerKey?: string;
  /** That record, when this read fetched it. Kept, and sent to no model. */
  customerRecord?: RawCustomerRecord;
}
