import type { FormDisplay } from "./flows";

/** ADO's FieldType values, as seen in the account-wide field list. */
export type AdoFieldType =
  | "string"
  | "integer"
  | "double"
  | "boolean"
  | "dateTime"
  | "plainText"
  | "html"
  | "treePath"
  | "history"
  | "guid"
  | "identity"
  | "picklistString";

/** One work-item field, as the MCP tool and the HTTP route both project it. */
export interface FieldSpec {
  reference_name: string;
  name: string;
  required: boolean;
  allowed_values?: unknown[];
  allowed_values_truncated?: true;
  default_value?: unknown;
  /** From the account-wide list; absent when the field is not defined there. */
  type?: AdoFieldType;
  read_only?: true;
  /**
   * An identity field takes a person. ADO resolves the string server-side and
   * rejects one it cannot match, so an email / unique name is the reliable
   * form — a display name alone is ambiguous.
   */
  is_identity?: true;
  help_text?: string;
}

export interface WorkItemSchema {
  project: string;
  type: string;
  fields: FieldSpec[];
  config_defaults: Record<string, unknown>;
}

/** A work item type the composer offers: what ADO's own "New" menu would list. */
export interface WorkItemTypeOption {
  name: string;
  description: string | null;
  /** Hex without the '#'. */
  color: string | null;
  /** ADO's stock glyph id, e.g. "icon_insect"; the browser draws its own. */
  icon: string | null;
}

/** A registered project the caller's team creates work items in. */
export interface ComposerProject {
  /** source_projects.id */
  id: string;
  name: string;
  /** The ADO project name. */
  external_key: string;
  source_slug: string;
  team_slug: string;
  product_slug: string | null;
}

/** Where a prefilled value came from, lowest precedence first. */
export type PrefillOrigin =
  "process" | "team" | "config" | "admin" | "template";

export interface PathOption {
  /** As System.AreaPath / System.IterationPath take it: `Project\Child`. */
  path: string;
  /** The team works in it; listed first. */
  team?: true;
  /** The iteration running today. */
  current?: true;
}

export interface PersonOption {
  name: string;
  /** What an identity field is sent: ADO resolves it unambiguously. */
  unique_name: string;
}

/** A group of fields as ADO's own form draws it. Null label: the form's header. */
export interface FormGroup {
  label: string | null;
  fields: string[];
}

/**
 * The type's form as its process lays it out, so the composer shows what ADO
 * shows. `body` is the long prose fields (written on the left); `groups` are
 * everything else (set on the right). Null when the layout cannot be read.
 */
export interface ComposerLayout {
  body: string[];
  groups: FormGroup[];
}

/**
 * A field whose control on ADO's form is not what its schema suggests: an
 * extension storing several values separated by ";", or a list that only
 * suggests values and accepts anything typed.
 */
export type FieldWidget =
  | { kind: "multi"; values: string[]; allow_custom: boolean }
  | { kind: "suggest"; values: string[] };

export interface ComposerForm {
  project: string;
  type: string;
  /** The ADO team the area, iteration, people and templates come from. */
  team: string | null;
  fields: FieldSpec[];
  prefill: Record<string, { value: unknown; origin: PrefillOrigin }>;
  areas: PathOption[];
  iterations: PathOption[];
  /** Members of every team in the project, the caller first. */
  people: PersonOption[];
  /** Whoever the caller's PAT belongs to. */
  me: PersonOption | null;
  templates: { id: string; name: string; description: string | null }[];
  layout: ComposerLayout | null;
  /** ADO's label on the form, where it differs from the field's name. */
  labels: Record<string, string>;
  widgets: Record<string, FieldWidget>;
  /** The team's own arrangement over the source's form, when it has one. */
  display?: FormDisplay;
}

/**
 * What the composer submits. HTML fields reference pasted images as
 * `attachment:<key>`; the server uploads them and rewrites the src.
 */
export interface TicketDraft {
  type: string;
  title: string;
  fields: Record<string, unknown>;
  tags?: string[];
  parent_id?: string;
  related_ids?: string[];
  /** Tachy work items this ticket is raised from; each records it as tracked_by. */
  work_item_ids?: string[];
}

export interface TicketValidation {
  ok: boolean;
  message?: string;
  /** Fields ADO's error names, by display or reference name as it wrote them. */
  fields?: string[];
}

export interface CreatedTicket {
  id: number | string;
  url: string;
  title: string;
  type: string;
  project: string;
}

/** A source item attached to the composer as context for the review. */
export interface TicketContextItem {
  source: string;
  external_id: string;
  title: string;
  /** Plain text, already trimmed by the browser. */
  text: string;
}

export type ReviewReadiness = "ready" | "almost" | "needs-work";
export type ReviewFindingKind = "gap" | "unclear" | "improve";

export interface ReviewFinding {
  id: string;
  /** A field's reference name, "System.Title", or "general". */
  field: string;
  kind: ReviewFindingKind;
  message: string;
  /** Text the user can insert as-is. Never a rewrite of the whole ticket. */
  suggestion?: string;
}

export interface TicketReview {
  /** False when no model credential resolves for the caller. */
  available: boolean;
  readiness: ReviewReadiness;
  summary: string;
  findings: ReviewFinding[];
}
