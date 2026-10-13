/** A stored copy of a ticket or work item, as a list shows it. */
export interface StoredItemRow {
  id: string;
  /** The source connection's slug. */
  connection: string;
  source_type: string;
  external_id: string;
  url: string | null;
  kind: string | null;
  title: string | null;
  /** As the source spells it: a Freshdesk status number, an ADO state. */
  status: string | null;
  /** The source's group: a Freshdesk group id, an ADO project. */
  group: string | null;
  assignee: string | null;
  priority: string | null;
  item_type: string | null;
  requester: string | null;
  customer: string | null;
  product: string | null;
  team: string | null;
  project: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** When it was last read whole. Null: only a listing has carried it, and it has no messages. */
  fetched_at: string | null;
  messages: number;
  events: number;
}

export interface StoredItemMessage {
  kind: "message";
  id: string;
  at: string | null;
  /** The source's account id for the sender, where it has one. */
  author: string | null;
  /** The sender as a person reads it: an address or a name. */
  author_label: string | null;
  automated: boolean;
  visibility: string | null;
  direction: string | null;
  text: string;
  files: number;
}

export interface StoredItemEvent {
  kind: "event";
  id: string;
  at: string;
  actor: string | null;
  /** status, assignee, group, priority, type, link, created, or the source's own field name. */
  field: string;
  old_value: string | null;
  new_value: string | null;
  /** `observed`: two reads differed, so it happened at or before `at`. */
  origin: "source" | "observed";
}

/** One entry of an item's timeline: something said, or something that happened. */
export type StoredItemEntry = StoredItemMessage | StoredItemEvent;

/** A stored item whole: its row, its timeline oldest first, its source's record of the customer. */
export interface StoredItem {
  item: StoredItemRow;
  timeline: StoredItemEntry[];
  customer_record: {
    name: string | null;
    record: Record<string, unknown>;
    fetched_at: string;
  } | null;
}

export interface StoredItemPage {
  /** How many the filter reaches, of which `items` is one page. */
  total: number;
  items: StoredItemRow[];
}
