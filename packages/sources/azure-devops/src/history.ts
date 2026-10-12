import type { RawEvent } from "@tachy/core/sources";
import type { AdoIdentity, AdoRelation, AdoUpdate } from "./client";

/** The fields tachy has its own word for. Every other one keeps its name. */
const TRACKED: Record<string, string> = {
  "System.State": "status",
  "System.AssignedTo": "assignee",
  "System.TeamProject": "group",
  "Microsoft.VSTS.Common.Priority": "priority",
  "System.WorkItemType": "type",
};

/**
 * Fields every revision rewrites, or that restate another change: the date
 * stamped when the state moved, the id behind an area path. `System.History`
 * is the comment the revision carried, which is one of the item's messages.
 */
const BOOKKEEPING = new Set([
  "System.Id",
  "System.Rev",
  "System.RevisedDate",
  "System.ChangedDate",
  "System.ChangedBy",
  "System.AuthorizedDate",
  "System.AuthorizedAs",
  "System.Watermark",
  "System.PersonId",
  "System.CommentCount",
  "System.History",
  "System.AreaId",
  "System.IterationId",
  "System.NodeName",
  "System.BoardColumnDone",
  "Microsoft.VSTS.Common.StateChangeDate",
  "Microsoft.VSTS.Common.ActivatedDate",
  "Microsoft.VSTS.Common.ActivatedBy",
  "Microsoft.VSTS.Common.ResolvedDate",
  "Microsoft.VSTS.Common.ResolvedBy",
  "Microsoft.VSTS.Common.ClosedDate",
  "Microsoft.VSTS.Common.ClosedBy",
]);

/** A board's own copy of a column or lane, one per board the item is on. */
const BOARD_FIELD = /^WEF_/;

/** Past this a value is prose (a description, repro steps) and is left out. */
const VALUE_MAX_CHARS = 200;

/** The date ADO gives a revision nothing has replaced yet. */
const NEVER_REVISED = "9999-";

function valueText(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    const name = (value as AdoIdentity).displayName;
    return typeof name === "string" ? name : null;
  }
  const text = String(value);
  return text.length > VALUE_MAX_CHARS ? null : text;
}

/**
 * When an update happened. One that changed fields says so in
 * `System.ChangedDate`; its `revisedDate` is when the revision it made was
 * replaced in turn. One that only changed links carries no fields, and its
 * `revisedDate` is the change itself.
 */
function occurredAt(update: AdoUpdate): string | undefined {
  const changed = update.fields?.["System.ChangedDate"]?.newValue;
  if (typeof changed === "string") return changed;
  const revised = update.revisedDate;
  return revised && !revised.startsWith(NEVER_REVISED) ? revised : undefined;
}

/** What a link points at: a work item by number, a file by name, else its address. */
function linkTarget(relation: AdoRelation): string {
  const url = relation.url ?? "";
  const workItemId = url.match(/\/workItems\/(\d+)$/i)?.[1];
  if (workItemId) return `#${workItemId}`;
  const fileName = relation.attributes?.name;
  return typeof fileName === "string" ? fileName : url;
}

const linkText = (relation: AdoRelation) =>
  `${relation.rel ?? "link"} ${linkTarget(relation)}`.trim();

/**
 * An item's updates as events: one per field a revision changed, one per link
 * added or removed. The update that created the item sets every field it has,
 * so it gives `created` and the fields tachy tracks, and no more.
 */
export function updateEvents(updates: AdoUpdate[]): RawEvent[] {
  const events: RawEvent[] = [];
  for (const update of updates) {
    const at = occurredAt(update);
    if (!at) continue;
    const actor = update.revisedBy?.displayName;
    const fields = update.fields ?? {};
    const created =
      "System.CreatedDate" in fields &&
      fields["System.CreatedDate"].oldValue == null;
    if (created)
      events.push({
        externalId: `${update.id}:created`,
        occurredAt: at,
        actor,
        field: "created",
      });

    for (const [name, change] of Object.entries(fields)) {
      if (BOOKKEEPING.has(name) || BOARD_FIELD.test(name)) continue;
      if (created && !(name in TRACKED)) continue;
      events.push({
        externalId: `${update.id}:${name}`,
        occurredAt: at,
        actor,
        field: TRACKED[name] ?? name,
        oldValue: valueText(change.oldValue),
        newValue: valueText(change.newValue),
      });
    }

    const links = [
      ...(update.relations?.added ?? []).map((relation, i) => ({
        key: `added:${i}`,
        newValue: linkText(relation),
      })),
      ...(update.relations?.removed ?? []).map((relation, i) => ({
        key: `removed:${i}`,
        oldValue: linkText(relation),
      })),
    ];
    for (const { key, ...values } of links)
      events.push({
        externalId: `${update.id}:link:${key}`,
        occurredAt: at,
        actor,
        field: "link",
        ...values,
      });
  }
  return events;
}
