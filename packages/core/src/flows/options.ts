import type { FlowOption } from "@tachy/contract";
import { readableBuckets } from "../buckets/access";
import { listBuckets } from "../buckets/buckets";
import { listCustomers } from "../catalog/customers";
import { listProducts } from "../catalog/products";
import { listTeams } from "../catalog/teams";
import { listRepos } from "../code/repos";
import type { ScopeContext } from "../config/scoped";
import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { describeJobKinds } from "../jobs/registry";
import { getSourceProject, listSourceProjects } from "../sources/projects";
import { resolveSource } from "../sources/registry";
import { customerPropertyOptions } from "./customer";
import { subjectFields, subjectValues } from "./subject";

export interface OptionRequest {
  /** The caller's scope: a source's lists are read with their credential. */
  scope: ScopeContext;
  /** The sibling params the source depends on, as the editor holds them. */
  params: Record<string, string>;
}

type OptionSource = (req: OptionRequest) => Promise<FlowOption[]>;

const sources = new Map<string, OptionSource>();

/** A named list a param's choices come from; `x-options` on the param names it. */
export function defineOptionSource(key: string, fn: OptionSource): void {
  sources.set(key, fn);
}

const need = (req: OptionRequest, name: string) => {
  const v = req.params[name];
  if (!v) throw badInput(`'${name}' is needed first`);
  return v;
};

/**
 * `source.<name>` asks the connection's adapter, so each source offers its
 * own lists (a helpdesk's companies, its ticket fields) without core knowing
 * them. `source.groups` is the adapter's probe, which every source has.
 */
async function fromSource(
  name: string,
  req: OptionRequest,
): Promise<FlowOption[]> {
  const { source } = await resolveSource(need(req, "connection"), req.scope);
  if (name === "groups") {
    if (!source.verify) return [];
    const probe = await source.verify();
    return probe.groups.map((g) => ({
      value: g.key,
      label: g.name,
      hint: g.key,
    }));
  }
  if (!source.options) return [];
  return source.options(name, req.params);
}

export async function listOptions(
  key: string,
  req: OptionRequest,
): Promise<FlowOption[]> {
  if (key.startsWith("source.")) return fromSource(key.slice(7), req);
  const fn = sources.get(key);
  if (!fn) throw badInput(`unknown option source '${key}'`);
  return fn(req);
}

defineOptionSource("connections", async (req) => {
  const rows = await sql`
    select slug, source_type from source_connections
    ${req.params.source_type ? sql`where source_type = ${req.params.source_type}` : sql``}
    order by slug
  `;
  return rows.map((r) => ({
    value: r.slug as string,
    label: r.slug as string,
    hint: r.source_type as string,
  }));
});

defineOptionSource("teams", async () =>
  (await listTeams()).map((t) => ({ value: t.slug, label: t.name })),
);

defineOptionSource("products", async () =>
  (await listProducts()).map((p) => ({
    value: p.slug,
    label: p.name,
    hint: p.team_slug,
  })),
);

defineOptionSource("customers", async () =>
  (await listCustomers()).map((c) => ({ value: c.slug, label: c.name })),
);

defineOptionSource("buckets", async (req) => {
  const ids = (await readableBuckets(req.scope.userId)).map((b) => b.id);
  if (!ids.length) return [];
  return (await listBuckets(ids)).map((b) => ({
    value: b.slug,
    label: b.name,
    hint: b.source ?? undefined,
  }));
});

defineOptionSource("repos", async () =>
  (await listRepos()).map((r) => ({
    value: r.slug,
    label: r.slug,
    hint: r.product_slug ?? undefined,
  })),
);

defineOptionSource("job.kinds", async () =>
  describeJobKinds()
    .filter((k) => k.kind !== "flow.run")
    .map((k) => ({ value: k.kind, label: k.title, hint: k.kind })),
);

defineOptionSource("item.fields", async (req) =>
  subjectFields(req.params.connection || undefined),
);

defineOptionSource("item.values", async (req) =>
  subjectValues(need(req, "connection"), need(req, "field")),
);

defineOptionSource("item.tags", async (req) =>
  req.params.connection
    ? subjectValues(req.params.connection, "item.tags")
    : [],
);

defineOptionSource("customer.properties", async (req) =>
  customerPropertyOptions(req.params.connection || undefined, req.scope),
);

// Items to try a flow on, by title or the source's id.
defineOptionSource("work_items", async (req) => {
  const q = req.params.q?.trim() ?? "";
  const rows = await sql`
    select wi.id, wi.external_id, wi.title, sc.slug
    from work_items wi join source_connections sc on sc.id = wi.source_connection_id
    where true
      ${req.params.connection ? sql`and sc.slug = ${req.params.connection}` : sql``}
      ${q ? sql`and (wi.external_id = ${q} or wi.title ilike ${"%" + q + "%"})` : sql``}
    order by wi.source_updated_at desc nulls last
    limit 50
  `;
  return rows.map((r) => ({
    value: r.id as string,
    label: `#${r.external_id} ${r.title ?? ""}`.trim(),
    hint: r.slug as string,
  }));
});

defineOptionSource("ado.projects", async () =>
  (await listSourceProjects())
    .filter((p) => p.source_type === "azure-devops")
    .map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.product_slug ?? p.team_slug,
    })),
);

defineOptionSource("ado.types", async (req) => {
  const project = await getSourceProject(need(req, "project"));
  const { source } = await resolveSource(project.source_slug, req.scope);
  if (!source.composer) return [];
  return (await source.composer.types(project.external_key)).map((t) => ({
    value: t.name,
    label: t.name,
  }));
});
