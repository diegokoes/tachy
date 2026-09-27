import type {
  AdoTypeOption,
  ComposerForm,
  PathOption,
  PersonOption,
  PrefillOrigin,
} from "@tachy/core";
import type { AdoClassificationNode, AdoClient } from "./client";
import { workItemSchema } from "./fields";

export type { AdoTypeOption, ComposerForm };

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
): Promise<AdoTypeOption[]> {
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

/**
 * Everything the composer needs to draw one type's form, in one call: the field
 * schema, the team's areas and iterations with its defaults, the people it can
 * assign to, and its templates. Each team-scoped lookup degrades on its own, so
 * a PAT without Project & Team read still gets a form, just with fewer choices.
 */
export async function composerForm(
  client: AdoClient,
  project: string,
  type: string,
  opts: { team?: string | null; configDefaults?: Record<string, unknown> } = {},
): Promise<ComposerForm> {
  const team =
    opts.team ??
    (await soft(client.getProject(project), null))?.defaultTeam?.name ??
    null;

  const [schema, settings, current, teamIterations, fieldValues] =
    await Promise.all([
      workItemSchema(client, project, type, opts.configDefaults ?? {}),
      team ? soft(client.getTeamSettings(project, team), null) : null,
      team ? soft(client.listTeamIterations(project, team, "current"), []) : [],
      team ? soft(client.listTeamIterations(project, team), []) : [],
      team ? soft(client.getTeamFieldValues(project, team), null) : null,
    ]);
  const [areaTree, iterationTree, members, templates] = await Promise.all([
    soft(client.getClassificationTree(project, "Areas", TREE_DEPTH), null),
    soft(client.getClassificationTree(project, "Iterations", TREE_DEPTH), null),
    team ? soft(client.listTeamMembers(project, team), []) : [],
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

  const people: PersonOption[] = members
    .map((m) => m.identity)
    .filter((i) => i?.uniqueName && !i.isContainer && !i.inactive)
    .map((i) => ({
      name: i!.displayName || i!.uniqueName!,
      unique_name: i!.uniqueName!,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const prefill: ComposerForm["prefill"] = {};
  const put = (ref: string, value: unknown, origin: PrefillOrigin) => {
    if (value == null || value === "") return;
    prefill[ref] = { value, origin };
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

  return {
    project,
    type,
    team,
    fields: schema.fields,
    prefill,
    areas,
    iterations,
    people,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description || null,
    })),
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
