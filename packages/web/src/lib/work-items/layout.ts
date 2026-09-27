import type { FieldSpec } from "@tachy/contract";

export const TITLE = "System.Title";
export const AREA = "System.AreaPath";
export const ITERATION = "System.IterationPath";
export const TAGS = "System.Tags";

/**
 * Fields ADO fills in itself or that describe an item's life after creation.
 * Several are not flagged read-only in the field list, so the flag alone would
 * put State, Reason and the board columns on a create form.
 */
const MANAGED = new Set([
  "System.Id",
  "System.Rev",
  "System.State",
  "System.Reason",
  "System.History",
  "System.TeamProject",
  "System.WorkItemType",
  "System.NodeName",
  "System.AreaId",
  "System.IterationId",
  "System.CreatedBy",
  "System.CreatedDate",
  "System.ChangedBy",
  "System.ChangedDate",
  "System.AuthorizedAs",
  "System.AuthorizedDate",
  "System.RevisedDate",
  "System.Watermark",
  "System.BoardColumn",
  "System.BoardColumnDone",
  "System.BoardLane",
  "System.CommentCount",
  "System.Parent",
  "Microsoft.VSTS.Common.StateChangeDate",
  "Microsoft.VSTS.Common.ActivatedBy",
  "Microsoft.VSTS.Common.ActivatedDate",
  "Microsoft.VSTS.Common.ResolvedBy",
  "Microsoft.VSTS.Common.ResolvedDate",
  "Microsoft.VSTS.Common.ResolvedReason",
  "Microsoft.VSTS.Common.ClosedBy",
  "Microsoft.VSTS.Common.ClosedDate",
]);

/** The handful every team sets, in the order a person thinks of them. */
const CORE = [
  AREA,
  ITERATION,
  "System.AssignedTo",
  "Microsoft.VSTS.Common.Priority",
  "Microsoft.VSTS.Common.Severity",
  TAGS,
];

export const editable = (f: FieldSpec) =>
  !f.read_only &&
  !MANAGED.has(f.reference_name) &&
  f.type !== "history" &&
  !/^System\.(AreaLevel|IterationLevel|ExternalLink|HyperLink|AttachedFile|RelatedLink|RemoteLink)/.test(
    f.reference_name,
  );

export const isBody = (f: FieldSpec) => f.type === "html";

export interface FieldLayout {
  /** Long HTML fields — Description, Repro Steps, System Info — as markdown. */
  body: FieldSpec[];
  core: FieldSpec[];
  /** Required by the type and not already above. */
  required: FieldSpec[];
  more: FieldSpec[];
}

export function layoutFields(fields: readonly FieldSpec[]): FieldLayout {
  const usable = fields.filter(
    (f) => f.reference_name !== TITLE && editable(f),
  );
  const body = usable.filter(isBody);
  const core = CORE.map((ref) =>
    usable.find((f) => f.reference_name === ref && !isBody(f)),
  ).filter((f): f is FieldSpec => !!f);
  const placed = new Set([...body, ...core].map((f) => f.reference_name));
  const required = usable.filter(
    (f) => f.required && !placed.has(f.reference_name),
  );
  for (const f of required) placed.add(f.reference_name);
  return {
    body,
    core,
    required,
    more: usable.filter((f) => !placed.has(f.reference_name)),
  };
}

/** A value the field would send: empty strings and blank lists are nothing. */
export const isEmpty = (v: unknown) =>
  v == null || (typeof v === "string" && !v.trim());

/**
 * Required fields still empty, by reference name. Prefills count: ADO applies
 * the same defaults, so a required field ADO will fill is not missing.
 */
export function missingRequired(
  fields: readonly FieldSpec[],
  title: string,
  values: Record<string, unknown>,
): string[] {
  const out = title.trim() ? [] : [TITLE];
  for (const f of fields)
    if (
      f.required &&
      editable(f) &&
      f.reference_name !== TITLE &&
      isEmpty(values[f.reference_name]) &&
      f.default_value == null
    )
      out.push(f.reference_name);
  return out;
}

/** ADO's error names a field by display or reference name; find which. */
export function fieldForName(
  fields: readonly FieldSpec[],
  name: string,
): string | null {
  const n = name.trim().toLowerCase();
  return (
    fields.find(
      (f) => f.reference_name.toLowerCase() === n || f.name.toLowerCase() === n,
    )?.reference_name ?? null
  );
}
