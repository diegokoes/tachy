import type {
  WorkItemTypeOption,
  ComposerForm,
  ComposerLayout,
  FieldSpec,
  FieldWidget,
  FormGroup,
  PathOption,
  PersonOption,
  PrefillOrigin,
} from "@tachy/core";
import type {
  AdoClassificationNode,
  AdoClient,
  AdoFormLayout,
  AdoLayoutControl,
} from "./client";
import { workItemSchema } from "./fields";

export type { WorkItemTypeOption, ComposerForm };

/** ADO keeps these out of its own "New work item" menu. */
const HIDDEN_CATEGORY = "Microsoft.HiddenCategory";

/** Enough to cover a real project's tree without shipping a whole org. */
const TREE_DEPTH = 4;
const MAX_PATHS = 400;

const AREA = "System.AreaPath";
const ITERATION = "System.IterationPath";

/**
 * The types a person can actually create: not disabled, and not in the hidden
 * category (code review, test plan, shared steps and the like). A failure to
 * read the categories hides nothing rather than failing the picker.
 */
export async function creatableTypes(
  client: AdoClient,
  project: string,
): Promise<WorkItemTypeOption[]> {
  const [types, categories] = await Promise.all([
    client.listWorkItemTypes(project),
    client.listTypeCategories(project).catch(() => []),
  ]);
  const hidden = new Set(
    categories
      .find((c) => c.referenceName === HIDDEN_CATEGORY)
      ?.workItemTypes?.map((t) => t.name) ?? [],
  );
  return types
    .filter((t) => !t.isDisabled && !hidden.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description || null,
      color: t.color || null,
      icon: t.icon?.id || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Team settings give paths relative to the project root, sometimes with a
 * leading backslash (`\Iteration 1`); the fields take `Project\Iteration 1`.
 */
export function fieldPath(
  project: string,
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const p = raw.replace(/^\\+/, "");
  if (!p) return project;
  const lower = p.toLowerCase();
  const root = project.toLowerCase();
  return lower === root || lower.startsWith(`${root}\\`)
    ? p
    : `${project}\\${p}`;
}

/** Paths from names rather than each node's `path`, which also carries the
 *  `\Area` / `\Iteration` structure segment the fields do not take. */
export function flattenTree(
  node: AdoClassificationNode | null | undefined,
): string[] {
  const out: string[] = [];
  const walk = (n: AdoClassificationNode, prefix: string) => {
    const here = prefix ? `${prefix}\\${n.name}` : n.name;
    out.push(here);
    for (const c of n.children ?? []) walk(c, here);
  };
  if (node?.name) walk(node, "");
  return out;
}

function mergePaths(first: PathOption[], rest: string[]): PathOption[] {
  const seen = new Set(first.map((o) => o.path.toLowerCase()));
  const out = [...first];
  for (const path of rest) {
    if (out.length >= MAX_PATHS) break;
    if (seen.has(path.toLowerCase())) continue;
    seen.add(path.toLowerCase());
    out.push({ path });
  }
  return out;
}

const soft = <T>(p: Promise<T>, fallback: T): Promise<T> =>
  p.catch(() => fallback);

/** How many of a project's teams are read for people to assign. */
const MAX_TEAMS = 30;

/** Header controls worth a field on a create form; State and Reason are ADO's. */
const HEADER = ["System.AssignedTo", AREA, ITERATION, "System.Tags"];

/** "Assi&gned To": the ampersand marks a keyboard accelerator in ADO's labels. */
const cleanLabel = (label: string | undefined) =>
  label?.replace(/&(?!&)/g, "").trim() || undefined;

const flag = (v: unknown) => v === true || v === "true" || v === "True";

/**
 * ADO's form for the type, as the composer's two columns: prose on the left,
 * everything else in ADO's own groups on the right. Hidden controls and groups
 * are left out, and an extension control is read for the field it binds to.
 */
export function projectLayout(
  layout: AdoFormLayout,
  fields: readonly FieldSpec[],
): {
  layout: ComposerLayout;
  labels: Record<string, string>;
  widgets: Record<string, FieldWidget>;
} {
  const specs = new Map(fields.map((f) => [f.reference_name, f]));
  const placed = new Set<string>();
  const labels: Record<string, string> = {};
  const widgets: Record<string, FieldWidget> = {};
  const body: string[] = [];
  const groups: FormGroup[] = [];

  const take = (c: AdoLayoutControl): string | null => {
    if (c.visible === false) return null;
    const inputs = c.contribution?.inputs ?? {};
    const ref =
      c.isContribution && typeof inputs.FieldName === "string"
        ? inputs.FieldName
        : (c.id ?? "");
    const spec = specs.get(ref);
    if (!spec || spec.read_only || placed.has(ref)) return null;
    placed.add(ref);
    const label = cleanLabel(c.label);
    if (label && label !== spec.name) labels[ref] = label;
    if (
      c.isContribution &&
      /multivalue/i.test(c.contribution?.contributionId ?? "")
    )
      widgets[ref] = {
        kind: "multi",
        values: String(inputs.Values ?? "")
          .split(";")
          .map((v) => v.trim())
          .filter(Boolean),
        allow_custom: flag(inputs.AllowCustom),
      };
    return ref;
  };

  const header: string[] = [];
  for (const ref of HEADER) {
    const c = layout.systemControls?.find((x) => x.id === ref) ?? { id: ref };
    const taken = take(c);
    if (taken) header.push(taken);
  }
  if (header.length) groups.push({ label: null, fields: header });

  for (const page of layout.pages ?? []) {
    if (page.pageType !== "custom" || page.visible === false) continue;
    for (const section of page.sections ?? [])
      for (const g of section.groups ?? []) {
        if (g.visible === false || g.isContribution) continue;
        const here: string[] = [];
        for (const c of g.controls ?? []) {
          const ref = take(c);
          if (!ref) continue;
          if (specs.get(ref)?.type === "html") body.push(ref);
          else here.push(ref);
        }
        if (here.length)
          groups.push({ label: cleanLabel(g.label) ?? null, fields: here });
      }
  }
  return { layout: { body, groups }, labels, widgets };
}

/**
 * A list that only offers ADO's "<None>" placeholder is a suggestion list:
 * Found In ships that way and real items carry versions typed by hand.
 */
function suggestionFields(
  fields: readonly FieldSpec[],
): Record<string, FieldWidget> {
  const out: Record<string, FieldWidget> = {};
  for (const f of fields) {
    const values = (f.allowed_values ?? []).map(String);
    if (values.length && values.every((v) => v === "<None>"))
      out[f.reference_name] = { kind: "suggest", values: [] };
  }
  return out;
}

async function readLayout(
  client: AdoClient,
  projectId: string | undefined,
  project: string,
  type: string,
): Promise<AdoFormLayout | null> {
  if (!projectId) return null;
  const [props, types] = await Promise.all([
    client.getProjectProperties(projectId, ["System.ProcessTemplateType"]),
    client.listWorkItemTypes(project),
  ]);
  const processId = props["System.ProcessTemplateType"];
  const ref = types.find((t) => t.name === type)?.referenceName;
  if (typeof processId !== "string" || !ref) return null;
  return client.getFormLayout(processId, ref);
}

async function whoAmI(client: AdoClient): Promise<PersonOption | null> {
  const u = (await client.getConnectionData()).authenticatedUser;
  const email = u?.properties?.Account?.$value;
  return email
    ? { name: u?.providerDisplayName || email, unique_name: email }
    : null;
}

/** Everyone on any of the project's teams: the default team is rarely all of them. */
async function projectPeople(
  client: AdoClient,
  project: string,
  me: PersonOption | null,
): Promise<PersonOption[]> {
  const teams = (await soft(client.listTeams(project), [])).slice(0, MAX_TEAMS);
  const lists = await Promise.all(
    teams.map((t) => soft(client.listTeamMembers(project, t.name), [])),
  );
  const byName = new Map<string, PersonOption>();
  for (const m of lists.flat()) {
    const i = m.identity;
    if (!i?.uniqueName || i.isContainer || i.inactive) continue;
    byName.set(i.uniqueName.toLowerCase(), {
      name: i.displayName || i.uniqueName,
      unique_name: i.uniqueName,
    });
  }
  if (me) byName.delete(me.unique_name.toLowerCase());
  const rest = [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return me ? [me, ...rest] : rest;
}

/**
 * Everything the composer needs to draw one type's form, in one call: the field
 * schema laid out as ADO's own form, the team's areas and iterations with its
 * defaults, the people it can assign to, and its templates. Each lookup beyond
 * the schema degrades on its own, so a PAT without Project & Team read still
 * gets a form, just with fewer choices.
 */
export async function composerForm(
  client: AdoClient,
  project: string,
  type: string,
  opts: { team?: string | null; configDefaults?: Record<string, unknown> } = {},
): Promise<ComposerForm> {
  const info = await soft(client.getProject(project), null);
  const team = opts.team ?? info?.defaultTeam?.name ?? null;

  const [schema, settings, current, teamIterations, fieldValues, layout, me] =
    await Promise.all([
      workItemSchema(client, project, type, opts.configDefaults ?? {}),
      team ? soft(client.getTeamSettings(project, team), null) : null,
      team ? soft(client.listTeamIterations(project, team, "current"), []) : [],
      team ? soft(client.listTeamIterations(project, team), []) : [],
      team ? soft(client.getTeamFieldValues(project, team), null) : null,
      soft(readLayout(client, info?.id, project, type), null),
      soft(whoAmI(client), null),
    ]);
  const [areaTree, iterationTree, people, templates] = await Promise.all([
    soft(client.getClassificationTree(project, "Areas", TREE_DEPTH), null),
    soft(client.getClassificationTree(project, "Iterations", TREE_DEPTH), null),
    projectPeople(client, project, me),
    team ? soft(client.listTemplates(project, team, type), []) : [],
  ]);

  const currentPath = fieldPath(project, current[0]?.path);
  const iterations = mergePaths(
    teamIterations
      .filter((i) => i.attributes?.timeFrame !== "past")
      .map((i) => fieldPath(project, i.path ?? i.name))
      .filter((p): p is string => !!p)
      .map((path) => ({
        path,
        team: true as const,
        ...(path === currentPath ? { current: true as const } : {}),
      })),
    flattenTree(iterationTree),
  );
  const areas = mergePaths(
    (fieldValues?.values ?? [])
      .map((v) => fieldPath(project, v.value))
      .filter((p): p is string => !!p)
      .map((path) => ({ path, team: true as const })),
    flattenTree(areaTree),
  );

  const specs = new Map(schema.fields.map((f) => [f.reference_name, f]));
  const prefill: ComposerForm["prefill"] = {};
  const put = (ref: string, value: unknown, origin: PrefillOrigin) => {
    if (value == null || value === "") return;
    // Process defaults for booleans arrive as "0"/"1".
    const v =
      specs.get(ref)?.type === "boolean" && typeof value === "string"
        ? value === "1" || value.toLowerCase() === "true"
        : value;
    prefill[ref] = { value: v, origin };
  };
  for (const f of schema.fields)
    if (!f.read_only) put(f.reference_name, f.default_value, "process");
  put(AREA, fieldPath(project, fieldValues?.defaultValue), "team");
  put(
    ITERATION,
    settings?.defaultIterationMacro?.toLowerCase() === "@currentiteration"
      ? currentPath
      : fieldPath(project, settings?.defaultIteration?.path),
    "team",
  );
  for (const [ref, value] of Object.entries(schema.config_defaults))
    put(ref, value, "config");

  const projected = layout ? projectLayout(layout, schema.fields) : null;
  return {
    project,
    type,
    team,
    fields: schema.fields,
    prefill,
    areas,
    iterations,
    people,
    me,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description || null,
    })),
    layout: projected?.layout ?? null,
    labels: projected?.labels ?? {},
    widgets: {
      ...suggestionFields(schema.fields),
      ...(projected?.widgets ?? {}),
    },
  };
}

/** A template's field values, minus the ones a new item cannot carry. */
export async function templateValues(
  client: AdoClient,
  project: string,
  team: string,
  id: string,
): Promise<Record<string, unknown>> {
  const t = await client.getTemplate(project, team, id);
  const skip = new Set([
    "System.WorkItemType",
    "System.TeamProject",
    "System.State",
    "System.Reason",
    "System.CreatedBy",
    "System.ChangedBy",
    "Microsoft.VSTS.Common.StateChangeDate",
  ]);
  return Object.fromEntries(
    Object.entries(t.fields ?? {}).filter(
      ([k, v]) => !skip.has(k) && v != null && typeof v !== "object",
    ),
  );
}
