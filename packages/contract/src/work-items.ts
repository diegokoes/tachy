import type {
  AdoFieldType,
  ComposerLayout,
  WorkItemPeek,
} from "./azure-devops";
import type { ViewDisplay } from "./flows";

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

/** How a list of items is ordered, by the source's own dates and fields. */
export const WORK_ITEM_SORTS = [
  "changed",
  "created",
  "id",
  "title",
  "state",
  "type",
  "assigned",
] as const;
export type WorkItemSort = (typeof WORK_ITEM_SORTS)[number];

/** Whose items: everyone's, or the ones assigned to, created or followed by the reader. */
export const WORK_ITEM_SCOPES = [
  "all",
  "assigned",
  "created",
  "followed",
] as const;
export type WorkItemScope = (typeof WORK_ITEM_SCOPES)[number];

export interface WorkItemQuery {
  sort: WorkItemSort;
  direction: "asc" | "desc";
  scope: WorkItemScope;
  type?: string;
  state?: string;
  /** Matched against the title; digits also match the id. */
  text?: string;
  /** The reader's followed items, for the `followed` scope. */
  ids?: string[];
  offset: number;
  limit: number;
}

/** One item of a live list, read from the source with the reader's token. */
export interface WorkItemRow extends WorkItemPeek {
  assigned_to: string | null;
  created_by: string | null;
  created_at: string | null;
  changed_at: string | null;
}

export interface WorkItemPage {
  items: WorkItemRow[];
  /** How many the query reached, up to the source's cap. */
  total: number;
  /** The query reached more than `total`. */
  capped: boolean;
}

export interface WorkItemFieldInfo {
  /** The label the source's form gives it, else the field's name. */
  name: string;
  type?: AdoFieldType;
}

/** The source's own form for a type, as a reader of an item sees it. */
export interface WorkItemLayout {
  layout: ComposerLayout | null;
  fields: Record<string, WorkItemFieldInfo>;
  /** The team's arrangement over the source's form, when it has one. */
  display?: ViewDisplay;
}

export interface LinkedWorkItem {
  id: number;
  title: string | null;
  state: string | null;
  type: string | null;
  url: string;
}

/** A pull request or commit the item links to; `note` when it could not be read. */
export interface LinkedCode {
  ref: string;
  title: string | null;
  status: string | null;
  author: string | null;
  repository: string | null;
  url: string | null;
  note?: string;
}

export interface WorkItemRelations {
  parent: LinkedWorkItem | null;
  children: LinkedWorkItem[];
  related: LinkedWorkItem[];
  pull_requests: LinkedCode[];
  commits: LinkedCode[];
}

export interface WorkItemComment {
  id: string;
  author: string | null;
  at: string | null;
  /**
   * As the source holds it: HTML, or Markdown for a comment written in it. The
   * board renders and sanitizes it before drawing.
   */
  html: string;
}

/** What the source says about one item read whole. */
export interface WorkItemReading {
  item: WorkItemRow;
  /** The source's own fields, by reference name. */
  fields: Record<string, unknown>;
  layout: WorkItemLayout;
  relations: WorkItemRelations;
  /** The conversation, oldest first. */
  comments: WorkItemComment[];
}

/** One item read whole, as the board shows it. */
export interface WorkItemView extends WorkItemReading {
  /** The stored copy the read refreshed. */
  stored_id: string;
  following: boolean;
  /** What changed on it and when, from the stored copy. */
  history: StoredItemEvent[];
}
