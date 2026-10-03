import type { FlowOption } from "@tachy/contract";
import { readPath } from "@tachy/contract";
import { sql } from "../infra/db";
import { notFound } from "../infra/errors";

/**
 * A work item as a flow reads it: what conditions test and `{{item.*}}`
 * fills in. `raw` is the source's own payload, so a source field tachy does
 * not model (a Freshdesk company, a custom field) is still reachable.
 */
export interface FlowSubject {
  id: string;
  external_id: string;
  url: string | null;
  kind: string;
  title: string | null;
  status: string | null;
  /** The source's group: a Freshdesk group, an ADO project. */
  group: string | null;
  requester: string | null;
  connection: string;
  source_type: string;
  customer: string | null;
  product: string | null;
  team: string | null;
  project: string | null;
  tags: string[];
  created_at: string | null;
  updated_at: string | null;
  customer_id: string | null;
  product_id: string | null;
  team_id: string | null;
  source_project_id: string | null;
  raw: Record<string, unknown>;
}

const SELECT = sql`
  select wi.id, wi.external_id, wi.external_url as url, wi.kind, wi.title, wi.status,
         wi.external_group_key as "group", wi.requester, wi.raw,
         wi.source_created_at as created_at, wi.source_updated_at as updated_at,
         wi.customer_id, wi.product_id, wi.team_id, wi.source_project_id,
         sc.slug as connection, sc.source_type,
         cu.slug as customer, p.slug as product, t.slug as team, sp.name as project
  from work_items wi
  join source_connections sc on sc.id = wi.source_connection_id
  left join customers cu on cu.id = wi.customer_id
  left join products p on p.id = wi.product_id
  left join teams t on t.id = wi.team_id
  left join source_projects sp on sp.id = wi.source_project_id
`;

const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v == null ? null : String(v);

function toSubject(row: Record<string, unknown>): FlowSubject {
  const raw = (row.raw ?? {}) as Record<string, unknown>;
  const adoTags = (raw.fields as Record<string, unknown> | undefined)?.[
    "System.Tags"
  ];
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(String)
    : typeof adoTags === "string"
      ? adoTags
          .split(";")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  return {
    ...(row as unknown as FlowSubject),
    raw,
    tags,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function loadSubject(workItemId: string): Promise<FlowSubject> {
  const [row] = await sql`${SELECT} where wi.id = ${workItemId}`;
  if (!row) throw notFound(`work item ${workItemId} not found`);
  return toSubject(row);
}

/** A connection's most recently changed items, newest first. */
export async function recentSubjects(
  connection: string,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<FlowSubject[]> {
  const rows = await sql`
    ${SELECT}
    where sc.slug = ${connection}
      ${opts.sinceDays ? sql`and wi.source_updated_at > now() - make_interval(days => ${opts.sinceDays})` : sql``}
    order by wi.source_updated_at desc nulls last
    limit ${opts.limit ?? 200}
  `;
  return rows.map(toSubject);
}

const FIXED: FlowOption[] = [
  { value: "item.title", label: "title" },
  { value: "item.status", label: "status" },
  { value: "item.group", label: "group", hint: "Freshdesk group, ADO project" },
  { value: "item.tags", label: "tags" },
  { value: "item.kind", label: "kind" },
  { value: "item.requester", label: "requester" },
  { value: "item.customer", label: "customer" },
  { value: "item.product", label: "product" },
  { value: "item.team", label: "team" },
  { value: "item.project", label: "project" },
  { value: "item.connection", label: "connection" },
  { value: "item.created_at", label: "created" },
  { value: "item.updated_at", label: "updated" },
];

const SAMPLE = 300;

/**
 * What a condition can test on a connection's items: tachy's own columns,
 * then every key the source's payloads carry, one level into objects such
 * as Freshdesk's `custom_fields`. Read from the items themselves, so a field
 * a source adds shows up without a change here.
 */
export async function subjectFields(
  connection?: string,
): Promise<FlowOption[]> {
  if (!connection) return FIXED;
  const rows = await sql`
    select raw from work_items wi
    join source_connections sc on sc.id = wi.source_connection_id
    where sc.slug = ${connection}
    order by wi.source_updated_at desc nulls last
    limit ${SAMPLE}
  `;
  const keys = new Set<string>();
  for (const { raw } of rows) {
    if (!raw || typeof raw !== "object") continue;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v))
        for (const sub of Object.keys(v)) keys.add(`${k}.${sub}`);
      else keys.add(k);
    }
  }
  return [
    ...FIXED,
    ...[...keys].sort().map((k) => ({
      value: `item.raw.${k}`,
      label: k,
      hint: "from the source",
    })),
  ];
}

/** The values a field takes on a connection's recent items, commonest first. */
export async function subjectValues(
  connection: string,
  field: string,
): Promise<FlowOption[]> {
  const counts = new Map<string, number>();
  for (const s of await recentSubjects(connection, { limit: SAMPLE })) {
    const v = readPath({ item: s }, field);
    for (const x of Array.isArray(v) ? v : [v]) {
      if (x == null || x === "" || typeof x === "object") continue;
      const key = String(x);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([value, n]) => ({ value, label: value, hint: `${n} items` }));
}
