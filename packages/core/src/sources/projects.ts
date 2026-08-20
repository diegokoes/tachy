import { sql } from "../infra/db";
import { badInput, conflict, notFound } from "../infra/errors";
import { getProductIdBySlug, getTeamIdBySlug } from "../catalog/products";
import { getCustomerIdBySlug } from "../catalog/customers";
import { resolveComponentStrict } from "../catalog/components";
import type { EntryScope } from "../access/permissions";

export const SOURCE_PROJECT_ROLES = ["knowledge", "tracker"] as const;
export type SourceProjectRole = (typeof SOURCE_PROJECT_ROLES)[number];

export interface ProjectWiki {
  identifier: string;
  name?: string;
  type?: string;
  root_path?: string;
  /** The one every tool uses when no wiki is named. Exactly one per project. */
  default?: boolean;
}

export interface SourceProjectInput {
  sourceSlug: string;
  externalKey: string;
  name?: string;
  role: SourceProjectRole;
  productSlug?: string | null;
  teamSlug?: string | null;
  /** Set when the whole project exists for one customer; null when it serves many. */
  customerSlug?: string | null;
  wikis?: ProjectWiki[] | null;
  config?: Record<string, unknown>;
  notes?: string | null;
}

export interface SourceProjectPatch {
  name?: string;
  role?: SourceProjectRole;
  productSlug?: string | null;
  teamSlug?: string | null;
  customerSlug?: string | null;
  wikis?: ProjectWiki[] | null;
  config?: Record<string, unknown>;
  notes?: string | null;
}

export interface SourceProjectRow {
  id: string;
  source_connection_id: string;
  source_slug: string;
  source_type: string;
  external_key: string;
  name: string;
  role: SourceProjectRole;
  product_id: string | null;
  product_slug: string | null;
  team_id: string;
  team_slug: string;
  customer_id: string | null;
  customer_slug: string | null;
  wikis: ProjectWiki[];
  config: Record<string, unknown>;
  notes: string | null;
  created_at: string;
}

const projectColumns = () => sql`
  sp.id, sp.source_connection_id, sc.slug as source_slug, sc.source_type,
  sp.external_key, sp.name, sp.role, sp.product_id, p.slug as product_slug,
  sp.team_id, t.slug as team_slug, sp.customer_id, cu.slug as customer_slug,
  sp.wikis, sp.config, sp.notes, sp.created_at
`;

const projectJoins = () => sql`
  from source_projects sp
  join source_connections sc on sc.id = sp.source_connection_id
  join teams t on t.id = sp.team_id
  left join products p on p.id = sp.product_id
  left join customers cu on cu.id = sp.customer_id
`;

export async function listSourceProjects(
  opts: {
    sourceSlug?: string;
    productId?: string;
    teamId?: string;
    role?: SourceProjectRole;
  } = {},
): Promise<SourceProjectRow[]> {
  return sql`
    select ${projectColumns()} ${projectJoins()}
    where 1=1
      ${opts.sourceSlug ? sql`and sc.slug = ${opts.sourceSlug}` : sql``}
      ${opts.productId ? sql`and sp.product_id = ${opts.productId}` : sql``}
      ${opts.teamId ? sql`and sp.team_id = ${opts.teamId}` : sql``}
      ${opts.role ? sql`and sp.role = ${opts.role}` : sql``}
    order by sc.slug, sp.name
  ` as Promise<SourceProjectRow[]>;
}

export async function getSourceProject(id: string): Promise<SourceProjectRow> {
  const [row] = await sql`
    select ${projectColumns()} ${projectJoins()} where sp.id = ${id}
  `;
  if (!row) throw notFound(`Source project '${id}' not found`);
  return row as SourceProjectRow;
}

/** Resolve by the key the source itself uses — ADO project name, Freshdesk group id. */
export async function resolveSourceProject(
  sourceSlug: string,
  externalKey: string,
): Promise<SourceProjectRow> {
  const [row] = await sql`
    select ${projectColumns()} ${projectJoins()}
    where sc.slug = ${sourceSlug} and sp.external_key = ${externalKey}
  `;
  if (row) return row as SourceProjectRow;

  const nearest = await sql`
    select sp.external_key from source_projects sp
    join source_connections sc on sc.id = sp.source_connection_id
    where sc.slug = ${sourceSlug}
    order by similarity(sp.external_key, ${externalKey}) desc
    limit 5
  `;
  const hint = nearest.length
    ? ` Registered projects: ${nearest.map((r) => `'${r.external_key}'`).join(", ")}.`
    : "";
  throw badInput(
    `'${externalKey}' is not registered on source '${sourceSlug}'.${hint} Call list_source_projects, or add_source_project to register it.`,
  );
}

interface ResolvedScope {
  productId: string | null;
  teamId: string;
}

async function resolveRoleScope(
  role: SourceProjectRole,
  productSlug: string | null | undefined,
  teamSlug: string | null | undefined,
): Promise<ResolvedScope> {
  if (role === "knowledge") {
    if (!productSlug)
      throw badInput(
        "a knowledge project needs a product — pass product_slug, or use role 'tracker' for a project we only create work items in",
      );
    const productId = await getProductIdBySlug(productSlug);
    const [prod] =
      await sql`select team_id from products where id = ${productId}`;
    return { productId, teamId: prod.team_id as string };
  }
  if (productSlug)
    throw badInput(
      "a tracker project has no product — it is a create/reassign target only. Use role 'knowledge' to bind it to a product.",
    );
  if (!teamSlug)
    throw badInput("a tracker project needs a team — pass team_slug");
  return { productId: null, teamId: await getTeamIdBySlug(teamSlug) };
}

/**
 * Drops anything without an identifier, de-duplicates, and settles the default:
 * whichever entry is flagged, else the first. Exactly one survives flagged, so
 * no caller has to cope with two — or with none, which would silently turn every
 * wiki tool into "name the wiki yourself".
 */
export function normalizeWikis(input: unknown): ProjectWiki[] {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: ProjectWiki[] = [];
  for (const raw of list) {
    const w = raw as ProjectWiki;
    const identifier = typeof w?.identifier === "string" ? w.identifier : "";
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    out.push({
      identifier,
      ...(w.name ? { name: w.name } : {}),
      ...(w.type ? { type: w.type } : {}),
      ...(w.root_path ? { root_path: w.root_path } : {}),
      ...(w.default ? { default: true } : {}),
    });
  }
  if (!out.length) return out;
  const chosen = out.findIndex((w) => w.default);
  return out.map((w, i) => {
    const { default: _drop, ...rest } = w;
    return i === (chosen === -1 ? 0 : chosen)
      ? { ...rest, default: true }
      : rest;
  });
}

/** The wiki every tool uses when the caller names none. */
export const defaultWiki = (wikis: ProjectWiki[]): ProjectWiki | null =>
  wikis.find((w) => w.default) ?? wikis[0] ?? null;

/** Resolve a caller-supplied wiki against what the project has registered. */
export const matchWiki = (
  wikis: ProjectWiki[],
  wanted: string,
): ProjectWiki | null => {
  const key = wanted.trim().toLowerCase();
  return (
    wikis.find(
      (w) =>
        w.identifier.toLowerCase() === key ||
        (w.name ?? "").toLowerCase() === key,
    ) ?? null
  );
};

function assertWikiAllowed(
  role: SourceProjectRole,
  wikis: ProjectWiki[] | null | undefined,
): void {
  if (role === "tracker" && wikis?.length)
    throw badInput(
      "a tracker project cannot own a wiki — its pages would have no product to be filed under",
    );
}

export async function addSourceProject(
  i: SourceProjectInput,
): Promise<SourceProjectRow> {
  const [conn] =
    await sql`select id from source_connections where slug = ${i.sourceSlug}`;
  if (!conn)
    throw badInput(
      `Unknown source connection '${i.sourceSlug}'. Call list_source_connections first.`,
    );
  if (!i.externalKey.trim()) throw badInput("external_key is required");
  const scope = await resolveRoleScope(i.role, i.productSlug, i.teamSlug);
  const wikis = normalizeWikis(i.wikis);
  assertWikiAllowed(i.role, wikis);
  const customerId = i.customerSlug
    ? await getCustomerIdBySlug(i.customerSlug)
    : null;

  const [row] = await sql`
    insert into source_projects
      (source_connection_id, external_key, name, product_id, team_id, customer_id, role, wikis, config, notes)
    values
      (${conn.id}, ${i.externalKey}, ${i.name || i.externalKey}, ${scope.productId},
       ${scope.teamId}, ${customerId}, ${i.role}, ${sql.json(wikis as any)},
       ${sql.json((i.config ?? {}) as any)}, ${i.notes ?? null})
    on conflict (source_connection_id, external_key) do update set
      name       = excluded.name,
      product_id = excluded.product_id,
      team_id    = excluded.team_id,
      customer_id = excluded.customer_id,
      role       = excluded.role,
      wikis      = excluded.wikis,
      config     = excluded.config,
      notes      = coalesce(excluded.notes, source_projects.notes)
    returning id
  `;
  return getSourceProject(row.id as string);
}

export async function updateSourceProject(
  id: string,
  patch: SourceProjectPatch,
): Promise<SourceProjectRow> {
  const current = await getSourceProject(id);
  const role = patch.role ?? current.role;
  const teamSlug = patch.teamSlug ?? current.team_slug;
  // An unchanged product is kept by id: its slug may be ambiguous across teams.
  const scope =
    role === "knowledge" &&
    patch.productSlug === undefined &&
    current.product_id
      ? { productId: current.product_id, teamId: current.team_id }
      : await resolveRoleScope(
          role,
          role === "knowledge" ? patch.productSlug : null,
          teamSlug,
        );
  const wikis = normalizeWikis(
    patch.wikis !== undefined ? patch.wikis : current.wikis,
  );
  assertWikiAllowed(role, wikis);
  const customerId =
    patch.customerSlug === undefined
      ? current.customer_id
      : patch.customerSlug
        ? await getCustomerIdBySlug(patch.customerSlug)
        : null;

  if (role === "tracker" && current.role === "knowledge") {
    const [refs] = await sql`
      select
        (select count(*)::int from project_area_map where source_project_id = ${id}) as areas,
        (select count(*)::int from repos where source_project_id = ${id}) as repos,
        (select count(*)::int from reference_docs where source_project_id = ${id}) as docs
    `;
    const parts = [
      refs.areas > 0 ? `${refs.areas} area rule(s)` : null,
      refs.repos > 0 ? `${refs.repos} repo(s)` : null,
      refs.docs > 0 ? `${refs.docs} reference doc(s)` : null,
    ].filter(Boolean);
    if (parts.length)
      throw conflict(
        `project '${current.external_key}' still has ${parts.join(", ")} — a tracker project holds none of those, so detach them first`,
      );
  }

  await sql`
    update source_projects set
      name       = ${patch.name ?? current.name},
      role       = ${role},
      product_id = ${scope.productId},
      team_id    = ${scope.teamId},
      customer_id = ${customerId},
      wikis      = ${sql.json(wikis as any)},
      config     = ${sql.json((patch.config ?? current.config) as any)},
      notes      = ${patch.notes !== undefined ? patch.notes : current.notes}
    where id = ${id}
  `;
  return getSourceProject(id);
}

export async function deleteSourceProject(id: string) {
  const current = await getSourceProject(id);
  const [refs] = await sql`
    select
      (select count(*)::int from repos where source_project_id = ${id}) as repos,
      (select count(*)::int from reference_docs where source_project_id = ${id}) as docs
  `;
  const parts = [
    refs.repos > 0 ? `${refs.repos} repo(s)` : null,
    refs.docs > 0 ? `${refs.docs} reference doc(s)` : null,
  ].filter(Boolean);
  if (parts.length)
    throw conflict(
      `project '${current.external_key}' is still referenced by ${parts.join(", ")} — re-point or delete those first`,
    );
  await sql`delete from source_projects where id = ${id}`;
  return { deleted: true, id, external_key: current.external_key };
}

/** The scope a caller must be able to edit to change this project. */
export async function sourceProjectScope(id: string): Promise<EntryScope> {
  const [row] =
    await sql`select product_id, team_id from source_projects where id = ${id}`;
  if (!row) throw notFound(`Source project '${id}' not found`);
  return { productId: row.product_id, teamId: row.team_id };
}

export interface AreaMapInput {
  sourceProjectId: string;
  areaPrefix: string;
  componentSlug: string;
}

export async function listProjectAreaMap(sourceProjectId: string) {
  return sql`
    select m.id, m.area_prefix, m.component_id, c.slug as component_slug, c.name as component_name
    from project_area_map m
    join components c on c.id = m.component_id
    where m.source_project_id = ${sourceProjectId}
    order by length(m.area_prefix) desc, m.area_prefix
  `;
}

export async function setProjectAreaMap(i: AreaMapInput) {
  const project = await getSourceProject(i.sourceProjectId);
  if (!project.product_id)
    throw badInput(
      `project '${project.external_key}' is a tracker — it has no product, so no components to map areas onto`,
    );
  if (!i.areaPrefix.trim()) throw badInput("area_prefix is required");
  const component = await resolveComponentStrict(
    project.product_id,
    i.componentSlug,
  );
  const [row] = await sql`
    insert into project_area_map (source_project_id, area_prefix, component_id)
    values (${i.sourceProjectId}, ${i.areaPrefix}, ${component.id})
    on conflict (source_project_id, area_prefix) do update set component_id = excluded.component_id
    returning id, area_prefix
  `;
  return {
    ...row,
    component_slug: component.slug,
    component_path: component.path,
  };
}

export async function deleteProjectAreaMap(id: string) {
  const [row] =
    await sql`delete from project_area_map where id = ${id} returning id`;
  if (!row) throw notFound(`Area mapping '${id}' not found`);
  return { deleted: true, id };
}

/** Longest matching prefix wins, so a rule on a sub-area beats the project root. */
export async function resolveAreaComponent(
  sourceProjectId: string,
  areaPath: string | null | undefined,
): Promise<{ id: string; slug: string } | null> {
  if (!areaPath) return null;
  const [row] = await sql`
    select c.id, c.slug
    from project_area_map m
    join components c on c.id = m.component_id
    where m.source_project_id = ${sourceProjectId}
      and starts_with(${areaPath}, m.area_prefix)
    order by length(m.area_prefix) desc
    limit 1
  `;
  return row ? { id: row.id as string, slug: row.slug as string } : null;
}

export interface ProjectRepoContext {
  id: string;
  slug: string;
  url: string;
  default_branch: string;
  component_id: string | null;
  component_slug: string | null;
  index_status: string;
  indexed_commit: string | null;
  last_indexed_at: string | null;
}

export interface ProjectContext {
  project: {
    id: string;
    external_key: string;
    name: string;
    role: SourceProjectRole;
    notes: string | null;
    config: Record<string, unknown>;
  };
  connection: {
    id: string;
    slug: string;
    source_type: string;
  };
  product: { id: string; slug: string } | null;
  team: { id: string; slug: string };
  customer: { id: string; slug: string } | null;
  /** The default wiki — what every tool uses when the caller names none. */
  wiki: ProjectWiki | null;
  /** All registered wikis. An ADO project routinely has several. */
  wikis: ProjectWiki[];
  repos: ProjectRepoContext[];
  areas: { area_prefix: string; component_slug: string }[];
}

export interface ProjectContextQuery {
  projectId?: string;
  sourceSlug?: string;
  externalKey?: string;
  productId?: string;
  productSlug?: string;
  workItemId?: string;
  role?: SourceProjectRole;
}

/**
 * Everything the agent needs about a project in one call: which connection and
 * ADO project, its wiki, and its repos with the component each one implements.
 */
export async function resolveProjectContext(
  q: ProjectContextQuery,
): Promise<ProjectContext[]> {
  let productId = q.productId;
  if (!productId && q.productSlug)
    productId = await getProductIdBySlug(q.productSlug);

  let projectId = q.projectId;
  if (!projectId && q.workItemId) {
    const [item] = await sql`
      select source_project_id, product_id from work_items where id = ${q.workItemId}
    `;
    if (!item) throw notFound(`Work item '${q.workItemId}' not found`);
    if (item.source_project_id) projectId = item.source_project_id as string;
    else if (!productId) productId = (item.product_id as string) ?? undefined;
    if (!projectId && !productId) return [];
  }

  const rows = (await sql`
    select ${projectColumns()} ${projectJoins()}
    where 1=1
      ${projectId ? sql`and sp.id = ${projectId}` : sql``}
      ${productId ? sql`and sp.product_id = ${productId}` : sql``}
      ${q.sourceSlug ? sql`and sc.slug = ${q.sourceSlug}` : sql``}
      ${q.externalKey ? sql`and sp.external_key = ${q.externalKey}` : sql``}
      ${q.role ? sql`and sp.role = ${q.role}` : sql``}
    order by sp.role, sp.name
  `) as SourceProjectRow[];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const productIds = rows
    .map((r) => r.product_id)
    .filter((v): v is string => v != null);
  // Repos linked before a project existed still carry only a product, so they
  // are picked up through it rather than disappearing from the context.
  const repos = await sql`
    select r.id, r.slug, r.url, r.default_branch, r.source_project_id, r.product_id,
           r.component_id, c.slug as component_slug,
           r.index_status, r.indexed_commit, r.last_indexed_at
    from repos r
    left join components c on c.id = r.component_id
    where r.source_project_id = any(${ids})
       or (r.source_project_id is null and r.product_id = any(${productIds}))
    order by r.slug
  `;
  const areas = await sql`
    select m.source_project_id, m.area_prefix, c.slug as component_slug
    from project_area_map m
    join components c on c.id = m.component_id
    where m.source_project_id = any(${ids})
    order by length(m.area_prefix) desc
  `;

  return rows.map((r) => ({
    project: {
      id: r.id,
      external_key: r.external_key,
      name: r.name,
      role: r.role,
      notes: r.notes,
      config: r.config ?? {},
    },
    connection: {
      id: r.source_connection_id,
      slug: r.source_slug,
      source_type: r.source_type,
    },
    product: r.product_id ? { id: r.product_id, slug: r.product_slug! } : null,
    team: { id: r.team_id, slug: r.team_slug },
    customer: r.customer_id
      ? { id: r.customer_id, slug: r.customer_slug! }
      : null,
    wiki: defaultWiki(normalizeWikis(r.wikis)),
    wikis: normalizeWikis(r.wikis),
    repos: repos
      .filter(
        (repo) =>
          repo.source_project_id === r.id ||
          (repo.source_project_id === null &&
            r.product_id !== null &&
            repo.product_id === r.product_id),
      )
      .map((repo) => ({
        id: repo.id,
        slug: repo.slug,
        url: repo.url,
        default_branch: repo.default_branch,
        component_id: repo.component_id,
        component_slug: repo.component_slug,
        index_status: repo.index_status,
        indexed_commit: repo.indexed_commit,
        last_indexed_at: repo.last_indexed_at,
      })),
    areas: areas
      .filter((a) => a.source_project_id === r.id)
      .map((a) => ({
        area_prefix: a.area_prefix,
        component_slug: a.component_slug,
      })),
  }));
}

/** For callers that must act on exactly one project (the ADO wiki/create tools). */
export async function resolveProjectContextStrict(
  q: ProjectContextQuery,
): Promise<ProjectContext> {
  const found = await resolveProjectContext(q);
  if (!found.length)
    throw badInput(
      "No registered project matches that — call list_source_projects, or register it in Admin > Org > projects.",
    );
  if (found.length > 1)
    throw badInput(
      `That matches ${found.length} projects (${found
        .map((c) => `'${c.project.external_key}'`)
        .join(", ")}) — name the one you mean.`,
    );
  return found[0];
}

export interface IngestRoute {
  sourceProjectId: string | null;
  productId: string | null;
  teamId: string | null;
  componentId: string | null;
  componentSlug: string | null;
  /** The customer the project itself belongs to, when it exists for exactly one. */
  customerId: string | null;
}

/** Where an incoming item belongs: its project, product/team, and component. */
export async function routeIngest(
  connId: string,
  groupKey: string | null | undefined,
  areaPath?: string | null,
): Promise<IngestRoute> {
  const empty: IngestRoute = {
    sourceProjectId: null,
    productId: null,
    teamId: null,
    componentId: null,
    componentSlug: null,
    customerId: null,
  };
  if (!groupKey) return empty;
  const [project] = await sql`
    select id, product_id, team_id, customer_id from source_projects
    where source_connection_id = ${connId} and external_key = ${groupKey}
  `;
  if (!project) return empty;
  const component = project.product_id
    ? await resolveAreaComponent(project.id as string, areaPath)
    : null;
  return {
    sourceProjectId: project.id as string,
    productId: project.product_id as string | null,
    teamId: project.team_id as string,
    componentId: component?.id ?? null,
    componentSlug: component?.slug ?? null,
    customerId: (project.customer_id as string | null) ?? null,
  };
}
