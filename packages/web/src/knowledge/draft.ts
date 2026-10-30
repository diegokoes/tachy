import {
  CLOUD_HINT,
  CLOUD_RE,
  MAX_ENTRY_TITLE_CHARS,
  RELATED_LINK_HINT,
  isRelatedLink,
} from "@tachy/contract";
import type { KnowledgeRow } from "./rows";

/** Everything the entry page edits, under the names the API takes. */
export type EntryDraft = {
  title: string;
  issueSummary: string;
  rootCause: string;
  resolution: string;
  investigation: string;
  symptoms: string[];
  signals: string[];
  tags: string[];
  relatedLinks: string[];
  status: string;
  supersededBy: string | null;
  confidence: string;
  resolutionClarity: string;
  cloud: string;
  resolutionPattern: string;
  hiddenFix: boolean;
  affectedVersion: string;
  fixedVersion: string;
  component: string;
  customerSlug: string;
  unit: string;
};

export type DraftField = keyof EntryDraft;

const FIELD_LABELS: Record<DraftField, string> = {
  title: "title",
  issueSummary: "summary",
  rootCause: "root cause",
  resolution: "resolution",
  investigation: "investigation",
  symptoms: "symptoms",
  signals: "signals",
  tags: "tags",
  relatedLinks: "related links",
  status: "status",
  supersededBy: "replacement",
  confidence: "confidence",
  resolutionClarity: "clarity",
  cloud: "environment",
  resolutionPattern: "pattern",
  hiddenFix: "hidden fix",
  affectedVersion: "affected version",
  fixedVersion: "fixed version",
  component: "component",
  customerSlug: "customer",
  unit: "unit",
};

/** A field as the entry page names it. */
export const fieldLabel = (field: DraftField) => FIELD_LABELS[field];

/** The fields the side column shows, beside the ones every entry has. */
const PROPERTY_FIELDS: DraftField[] = [
  "customerSlug",
  "unit",
  "cloud",
  "resolutionPattern",
  "hiddenFix",
  "confidence",
  "resolutionClarity",
  "affectedVersion",
  "fixedVersion",
];

export const holdsProperties = (draft: EntryDraft) =>
  PROPERTY_FIELDS.some((field) => Boolean(draft[field]));

/** Text fields where an empty string means none, which the API clears with null. */
const CLEARABLE = new Set<DraftField>([
  "issueSummary",
  "rootCause",
  "resolution",
  "investigation",
  "confidence",
  "resolutionClarity",
  "cloud",
  "resolutionPattern",
  "affectedVersion",
  "fixedVersion",
  "component",
  "customerSlug",
  "unit",
]);

export function draftFrom(row: KnowledgeRow): EntryDraft {
  return {
    title: row.title,
    issueSummary: row.issue_summary ?? "",
    rootCause: row.root_cause ?? "",
    resolution: row.resolution ?? "",
    investigation: row.investigation ?? "",
    symptoms: row.symptoms ?? [],
    signals: row.signals ?? [],
    tags: row.tags ?? [],
    relatedLinks: row.related_links ?? [],
    status: row.status,
    supersededBy: row.superseded_by ?? null,
    confidence: row.confidence ?? "",
    resolutionClarity: row.resolution_clarity ?? "",
    cloud: row.cloud ?? "",
    resolutionPattern: row.resolution_pattern ?? "",
    hiddenFix: row.hidden_fix ?? false,
    affectedVersion: row.affected_version ?? "",
    fixedVersion: row.fixed_version ?? "",
    component: row.component_slug ?? "",
    customerSlug: row.customer_slug ?? "",
    unit: row.customer_unit_slug ?? "",
  };
}

/** A new entry. Approved, as the API defaults it. */
export const blankDraft = (): EntryDraft => ({
  title: "",
  issueSummary: "",
  rootCause: "",
  resolution: "",
  investigation: "",
  symptoms: [],
  signals: [],
  tags: [],
  relatedLinks: [],
  status: "approved",
  supersededBy: null,
  confidence: "",
  resolutionClarity: "",
  cloud: "",
  resolutionPattern: "",
  hiddenFix: false,
  affectedVersion: "",
  fixedVersion: "",
  component: "",
  customerSlug: "",
  unit: "",
});

/** Text that differs only in surrounding whitespace is the same value. */
function sameValue(before: unknown, after: unknown): boolean {
  if (Array.isArray(before) && Array.isArray(after))
    return before.join("\0") === after.join("\0");
  if (typeof before === "string" && typeof after === "string")
    return before.trim() === after.trim();
  return before === after;
}

/** `draft` moved to `status`. A replacement only means something on a deprecated entry. */
export function withStatus(draft: EntryDraft, status: string): EntryDraft {
  const supersededBy = status === "deprecated" ? draft.supersededBy : null;
  return { ...draft, status, supersededBy };
}

/** The fields `after` changes from `before`. */
export function editedFields(
  before: EntryDraft,
  after: EntryDraft,
): DraftField[] {
  return (Object.keys(after) as DraftField[]).filter(
    (field) => !sameValue(before[field], after[field]),
  );
}

function sentValue(field: DraftField, value: EntryDraft[DraftField]) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text && CLEARABLE.has(field)) return null;
  return text;
}

/** The PATCH body that turns `before` into `after`: only the changed fields. */
export function entryPatch(
  before: EntryDraft,
  after: EntryDraft,
): Record<string, unknown> {
  return Object.fromEntries(
    editedFields(before, after).map((field) => [
      field,
      sentValue(field, after[field]),
    ]),
  );
}

/** The POST body for a new entry: every field that holds something. */
export const createPayload = (draft: EntryDraft) =>
  entryPatch(blankDraft(), draft);

/**
 * `after`'s edits laid over a newer saved state, so a save that lost a
 * version race can be tried again without retyping. Where both changed a
 * field, `after` wins.
 */
export function rebase(
  newer: EntryDraft,
  before: EntryDraft,
  after: EntryDraft,
): EntryDraft {
  const rebased = { ...newer };
  const keep = <F extends DraftField>(field: F) => {
    rebased[field] = after[field];
  };
  editedFields(before, after).forEach(keep);
  return rebased;
}

export type DraftProblems = Partial<
  Record<"title" | "issueSummary" | "cloud" | "relatedLinks", string>
>;

/** What blocks saving `draft`, by field. A summary is asked for on create only. */
export function draftProblems(
  draft: EntryDraft,
  { requireSummary = false } = {},
): DraftProblems {
  const problems: DraftProblems = {};
  const title = draft.title.trim();
  if (!title) problems.title = "a title is required";
  else if (title.length > MAX_ENTRY_TITLE_CHARS)
    problems.title = `a title fits ${MAX_ENTRY_TITLE_CHARS} characters`;
  if (requireSummary && !draft.issueSummary.trim())
    problems.issueSummary = "a summary is required";
  if (draft.cloud && !CLOUD_RE.test(draft.cloud)) problems.cloud = CLOUD_HINT;
  if (!draft.relatedLinks.every(isRelatedLink))
    problems.relatedLinks = RELATED_LINK_HINT;
  return problems;
}
