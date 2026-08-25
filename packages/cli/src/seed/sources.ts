import { WORK_ITEM_LINK_KINDS } from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import {
  chance,
  intBetween,
  pastDate,
  pick,
  rngFor,
  uuidFor,
} from "./deterministic";
import { SYMPTOMS } from "./corpus";
import type { SeededProduct, SeededTeam } from "./org";
import type { SeededComponent, SeededCustomer } from "./catalog";
import type { Volumes } from "./scale";

export interface SeededProject {
  id: string;
  connectionId: string;
  role: string;
}
export interface SeededWorkItem {
  id: string;
  connectionId: string;
  externalId: string;
}
export interface Sources {
  connections: { id: string; slug: string }[];
  projects: SeededProject[];
  workItems: SeededWorkItem[];
}

const CONNECTIONS = [
  ["freshdesk", "support-desk", "https://seed.freshdesk.com"],
  ["github", "product-github", "https://github.com"],
  ["azure-devops", "eng-ado", "https://dev.azure.com/seed"],
] as const;

const STATUSES = ["open", "pending", "resolved", "closed"];

export async function seedSources(
  tx: Tx,
  v: Volumes,
  teams: SeededTeam[],
  products: SeededProduct[],
  customers: SeededCustomer[],
  components: SeededComponent[],
): Promise<Sources> {
  const connections = CONNECTIONS.map(([type, slug], i) => ({
    id: uuidFor("source_connection", i),
    slug,
    type,
  }));
  await insertRows(
    tx,
    "source_connections",
    ["id", "source_type", "slug", "base_url"],
    connections.map((c, i) => ({
      id: c.id,
      source_type: c.type,
      slug: c.slug,
      base_url: CONNECTIONS[i][2],
    })),
  );

  // role='knowledge' must have a product, role='tracker' must not -- the
  // schema ties the two together with a CHECK.
  const projects: SeededProject[] = [];
  const projectRows: Record<string, unknown>[] = [];
  for (let i = 0; i < v.sourceProjects; i++) {
    const conn = connections[i % connections.length];
    const role = i % 3 === 2 ? "tracker" : "knowledge";
    const product = products[i % products.length];
    const id = uuidFor("source_project", i);
    projects.push({ id, connectionId: conn.id, role });
    projectRows.push({
      id,
      source_connection_id: conn.id,
      // Enumerated per connection, so (connection, external_key) is unique.
      external_key: `${480_000 + i}`,
      name: `Seeded project ${i}`,
      product_id: role === "knowledge" ? product.id : null,
      // team_id is NOT NULL, and must match the product's team so the
      // scope checks in sourceProjectScope stay coherent.
      team_id:
        role === "knowledge" ? product.teamId : teams[i % teams.length].id,
      customer_id: chance(rngFor("project", i), 0.2)
        ? customers[i % customers.length].id
        : null,
      role,
    });
  }
  await insertRows(
    tx,
    "source_projects",
    [
      "id",
      "source_connection_id",
      "external_key",
      "name",
      "product_id",
      "team_id",
      "customer_id",
      "role",
    ],
    projectRows,
  );

  await seedProjectAreas(tx, v, projects, components);
  const workItems = await seedWorkItems(
    tx,
    v,
    connections,
    projects,
    products,
    customers,
  );
  await seedMessages(tx, v, workItems);
  await seedLinks(tx, v, workItems, projects);

  return { connections, projects, workItems };
}

async function seedProjectAreas(
  tx: Tx,
  v: Volumes,
  projects: SeededProject[],
  components: SeededComponent[],
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const perProject = Math.max(
    1,
    Math.ceil(v.projectAreas / Math.max(1, projects.length)),
  );
  for (const p of projects) {
    for (let i = 0; i < perProject && rows.length < v.projectAreas; i++) {
      const comp = components[(rows.length * 3) % components.length];
      rows.push({
        id: uuidFor("project_area", rows.length),
        source_project_id: p.id,
        // Enumerated per project, so (project, prefix) is unique.
        area_prefix: `Area\\Team ${i}`,
        component_id: comp.id,
      });
    }
  }
  await insertRows(
    tx,
    "project_area_map",
    ["id", "source_project_id", "area_prefix", "component_id"],
    rows,
  );
}

async function seedWorkItems(
  tx: Tx,
  v: Volumes,
  connections: { id: string; slug: string }[],
  projects: SeededProject[],
  products: SeededProduct[],
  customers: SeededCustomer[],
): Promise<SeededWorkItem[]> {
  const knowledgeProjects = projects.filter((p) => p.role === "knowledge");
  const items: SeededWorkItem[] = [];
  const rows: Record<string, unknown>[] = [];

  // external_id is a per-connection counter, so (connection, external_id)
  // is unique without needing a conflict clause.
  const counters = new Map<string, number>();

  for (let i = 0; i < v.workItems; i++) {
    const conn = connections[i % connections.length];
    const next = (counters.get(conn.id) ?? 0) + 1;
    counters.set(conn.id, next);
    const externalId = `${next}`;
    const id = uuidFor("work_item", i);
    items.push({ id, connectionId: conn.id, externalId });

    const rng = rngFor("work_item", i);
    const project = knowledgeProjects[i % knowledgeProjects.length];
    const product = products[i % products.length];
    const symptom = SYMPTOMS[i % SYMPTOMS.length];
    const created = pastDate(rng, 540);

    rows.push({
      id,
      source_connection_id: conn.id,
      external_id: externalId,
      external_url: `https://example.invalid/${conn.slug}/${externalId}`,
      kind: pick(rng, ["ticket", "issue", "bug", "task"]),
      title: `${symptom} on ${product.slug}`,
      status: pick(rng, STATUSES),
      external_group_key: `${480_000 + (i % 8)}`,
      source_project_id: project.id,
      product_id: product.id,
      team_id: product.teamId,
      customer_id: chance(rng, 0.75)
        ? customers[i % customers.length].id
        : null,
      observed_version: `${intBetween(rng, 3, 9)}.${intBetween(rng, 0, 12)}`,
      requester: `contact${i % 200}@example.invalid`,
      // Capped deliberately: a realistic blob dominates database size at 40k.
      raw: JSON.stringify({
        seeded: true,
        symptom,
        priority: intBetween(rng, 1, 4),
      }),
      source_created_at: created,
      source_updated_at: new Date(
        created.getTime() + intBetween(rng, 0, 72) * 3_600_000,
      ),
    });
  }

  await insertRows(
    tx,
    "work_items",
    [
      "id",
      "source_connection_id",
      "external_id",
      "external_url",
      "kind",
      "title",
      "status",
      "external_group_key",
      "source_project_id",
      "product_id",
      "team_id",
      "customer_id",
      "observed_version",
      "requester",
      "raw",
      "source_created_at",
      "source_updated_at",
    ],
    rows,
  );
  return items;
}

async function seedMessages(
  tx: Tx,
  v: Volumes,
  items: SeededWorkItem[],
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const per = Math.max(1, Math.floor(v.workItemMessages / items.length));
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    for (let k = 0; k < per; k++) {
      const rng = rngFor("message", rows.length);
      rows.push({
        id: uuidFor("work_item_message", rows.length),
        work_item_id: item.id,
        // Per-item ordinal: (work_item_id, external_id) is unique.
        external_id: `${k}`,
        author: k % 2 === 0 ? "customer@example.invalid" : "agent@tachy.local",
        visibility: chance(rng, 0.2) ? "private" : "public",
        direction: k % 2 === 0 ? "inbound" : "outbound",
        body_text:
          k === 0
            ? `We are seeing: ${SYMPTOMS[i % SYMPTOMS.length]}. It started after the last upgrade.`
            : `Update ${k}: checked the logs, ${pick(rng, ["no change", "partially reproduced", "confirmed", "cannot reproduce"])}.`,
        created_at: pastDate(rng, 500),
      });
    }
  }
  await insertRows(
    tx,
    "work_item_messages",
    [
      "id",
      "work_item_id",
      "external_id",
      "author",
      "visibility",
      "direction",
      "body_text",
      "created_at",
    ],
    rows,
  );
}

/**
 * Two disjoint row shapes. The schema has one partial unique index per shape,
 * and the CHECK needs at least one target; keeping "points at an ingested
 * item" and "points at an id we have not ingested" strictly separate means
 * neither index can ever see the other's rows.
 */
async function seedLinks(
  tx: Tx,
  v: Volumes,
  items: SeededWorkItem[],
  projects: SeededProject[],
): Promise<void> {
  if (items.length < 2) return;
  const trackers = projects.filter((p) => p.role === "tracker");
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (
    let i = 0;
    i < v.workItemLinks * 2 && rows.length < v.workItemLinks;
    i++
  ) {
    const rng = rngFor("link", i);
    const from = items[i % items.length];
    const kind = pick(rng, WORK_ITEM_LINK_KINDS);
    const external = trackers.length > 0 && i % 10 >= 7;

    if (external) {
      const project = trackers[i % trackers.length];
      const externalId = `${50_000 + (i % 5_000)}`;
      const key = `e:${from.id}:${project.id}:${externalId}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        id: uuidFor("work_item_link", rows.length),
        from_work_item_id: from.id,
        to_work_item_id: null,
        to_source_project_id: project.id,
        to_external_id: externalId,
        kind,
      });
    } else {
      const to = items[(i * 7919 + 1) % items.length];
      if (to.id === from.id) continue;
      const key = `i:${from.id}:${to.id}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        id: uuidFor("work_item_link", rows.length),
        from_work_item_id: from.id,
        to_work_item_id: to.id,
        to_source_project_id: null,
        to_external_id: null,
        kind,
      });
    }
  }

  await insertRows(
    tx,
    "work_item_links",
    [
      "id",
      "from_work_item_id",
      "to_work_item_id",
      "to_source_project_id",
      "to_external_id",
      "kind",
    ],
    rows,
  );
}
