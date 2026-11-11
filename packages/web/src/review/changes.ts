import { PENDING_PROPOSAL_STATUSES, type ProposalRow } from "@tachy/contract";
import {
  blankDraft,
  editedFields,
  fieldLabel,
  patched,
  type DraftField,
  type EntryDraft,
} from "../knowledge/draft";
import { diffItems, diffWords, type DiffPart } from "./diff";

export interface FieldChange {
  field: DraftField;
  label: string;
  /** One part per item for a list field, runs of words for any other. */
  parts: DiffPart[];
  isList: boolean;
  /** The whole value was replaced, so the old and new stand on lines of their own. */
  isRewrite: boolean;
  /** Someone else changed the field on the entry after the patch was written. */
  conflicting: boolean;
}

type Proposed = Pick<
  ProposalRow,
  "kind" | "status" | "patch" | "conflicting_fields"
>;

const pendingStatuses: readonly string[] = PENDING_PROPOSAL_STATUSES;

const isChanged = (part: DiffPart) => part.change !== "same";

function shownText(value: EntryDraft[DraftField]): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.join("\n");
  return value ?? "";
}

function fieldChange(
  field: DraftField,
  before: EntryDraft,
  after: EntryDraft,
  conflicts: Set<string>,
): FieldChange {
  const was = before[field];
  const now = after[field];
  const isList = Array.isArray(now);
  const parts =
    Array.isArray(was) && Array.isArray(now)
      ? diffItems(was, now)
      : diffWords(shownText(was), shownText(now));
  return {
    field,
    label: fieldLabel(field),
    parts,
    isList,
    isRewrite: !isList && parts.length > 1 && parts.every(isChanged),
    conflicting: conflicts.has(field),
  };
}

/**
 * What a proposal changes, field by field. `entry` is the entry as it is now:
 * the draft itself for a new entry, the live one for an edit. A new entry and
 * a decided edit have nothing to compare with, so their fields show the
 * proposed values unmarked.
 */
export function proposedChanges(
  entry: EntryDraft,
  proposal: Proposed,
): FieldChange[] {
  if (proposal.kind === "new")
    return editedFields(blankDraft(), entry)
      .filter((field) => field !== "status")
      .map((field) => fieldChange(field, entry, entry, new Set()));
  const patch = proposal.patch ?? {};
  const after = patched(entry, patch);
  const before = pendingStatuses.includes(proposal.status) ? entry : after;
  const conflicts = new Set(proposal.conflicting_fields ?? []);
  return (Object.keys(entry) as DraftField[])
    .filter((field) => field in patch)
    .map((field) => fieldChange(field, before, after, conflicts));
}

/** Field keys under the names the entry page gives them, in its order. */
export const fieldLabels = (fields: string[]): string[] =>
  (Object.keys(blankDraft()) as DraftField[])
    .filter((field) => fields.includes(field))
    .map(fieldLabel);

export const patchLabels = (patch: Record<string, unknown> | null): string[] =>
  fieldLabels(Object.keys(patch ?? {}));

/** What the entry page tells a person about their own waiting proposal. */
export function pendingLine(
  proposal: Pick<ProposalRow, "kind" | "status" | "patch">,
): string {
  const subject =
    proposal.kind === "new"
      ? "this draft"
      : `your change to ${patchLabels(proposal.patch).join(", ")}`;
  return proposal.status === "returned"
    ? `a reviewer sent ${subject} back`
    : `${subject} waits for review`;
}
