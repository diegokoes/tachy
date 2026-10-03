import type { ComposerForm, FieldSpec } from "@tachy/contract";

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
  /** Long HTML fields - Description, Repro Steps, System Info - as markdown. */
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

export interface Arranged {
  /** Written: title's companions, on the left. */
  body: FieldSpec[];
  /** Set: everything else, in ADO's groups, on the right. */
  groups: { label: string | null; fields: FieldSpec[] }[];
  /** On the type but not on ADO's form; kept out of the way. */
  hidden: FieldSpec[];
}

/** The source's own arrangement: its layout when it has one, else a guess. */
function sourceArrangement(form: ComposerForm): Arranged {
  if (!form.layout) {
    const l = layoutFields(form.fields);
    return {
      body: l.body,
      groups: [
        { label: null, fields: l.core },
        { label: "required", fields: l.required },
      ].filter((g) => g.fields.length),
      hidden: l.more,
    };
  }
  const specs = new Map(form.fields.map((f) => [f.reference_name, f]));
  const usable = (ref: string) => {
    const f = specs.get(ref);
    return f && f.reference_name !== TITLE && editable(f) ? [f] : [];
  };
  const body = form.layout.body.flatMap(usable);
  const groups = form.layout.groups
    .map((g) => ({ label: g.label, fields: g.fields.flatMap(usable) }))
    .filter((g) => g.fields.length);
  const placed = new Set(
    [...body, ...groups.flatMap((g) => g.fields)].map((f) => f.reference_name),
  );
  return {
    body,
    groups,
    hidden: form.fields.filter(
      (f) =>
        f.reference_name !== TITLE &&
        editable(f) &&
        !placed.has(f.reference_name),
    ),
  };
}

const byOrder = (order: string[]) => {
  const at = new Map(order.map((r, i) => [r, i]));
  return (a: FieldSpec, b: FieldSpec) =>
    (at.get(a.reference_name) ?? Infinity) -
    (at.get(b.reference_name) ?? Infinity);
};

/**
 * The source's form with the team's choices laid over it: fields it shows,
 * folds away or leaves out, and their order. One rule overrides both: a
 * field the source requires, with nothing to fill it, is always on screen,
 * since leaving it off would only move the failure to create.
 */
export function arrange(form: ComposerForm): Arranged {
  const base = sourceArrangement(form);
  const show = form.display?.show ?? {};
  const specs = new Map(form.fields.map((f) => [f.reference_name, f]));
  const moved = new Set(
    Object.keys(show).filter((r) => {
      const f = specs.get(r);
      return f && r !== TITLE && editable(f);
    }),
  );
  const keep = (f: FieldSpec) => !moved.has(f.reference_name);

  const body = base.body.filter(keep);
  const groups = base.groups.map((g) => ({
    ...g,
    fields: g.fields.filter(keep),
  }));
  const folded: FieldSpec[] = [];
  const added: FieldSpec[] = [];
  const excluded: FieldSpec[] = [];
  for (const ref of moved) {
    const f = specs.get(ref)!;
    if (show[ref] === "hidden") excluded.push(f);
    else if (show[ref] === "fold") folded.push(f);
    else if (isBody(f)) body.push(f);
    else added.push(f);
  }
  if (added.length) groups.push({ label: "more", fields: added });

  const sort = byOrder(form.display?.order ?? []);
  body.sort(sort);
  for (const g of groups) g.fields.sort(sort);

  const rest = [...folded, ...base.hidden.filter(keep)];
  const unfilled = [...rest, ...excluded].filter(
    (f) =>
      f.required &&
      f.default_value == null &&
      !(f.reference_name in form.prefill),
  );
  if (unfilled.length)
    groups.push({ label: "also required", fields: unfilled });
  return {
    body,
    groups: groups.filter((g) => g.fields.length),
    hidden: rest.filter((f) => !unfilled.includes(f)),
  };
}

/** The label ADO's form uses, falling back to the field's own name. */
export const labelOf = (form: ComposerForm | null, f: FieldSpec) =>
  form?.labels[f.reference_name] ?? f.name;
