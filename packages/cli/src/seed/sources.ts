import { WORK_ITEM_LINK_KINDS } from "@tachy/core/work-items";
import { insertRows, insertWindowed, type Tx } from "./batches";
import {
  chance,
  intBetween,
  pastDate,
  pick,
  rngFor,
  uuidFor,
} from "./deterministic";
import {
  CONTEXTS,
  DIAGNOSTICS,
  IMPACTS,
  MESSAGE_OPENERS,
  MESSAGE_OUTCOMES,
  MESSAGE_STEPS,
  SYMPTOMS,
} from "./corpus";
import type { SeededProduct, SeededTeam, SeededUser } from "./org";
import type { SeededComponent, SeededCustomer } from "./catalog";
import type { Volumes } from "./scale";

export interface SeededProject {
  id: string;
  connectionId: string;
  hasProduct: boolean;
}
export interface SeededWorkItem {
  id: string;
  connectionId: string;
  externalId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
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
/** How many companies each connection's items are spread over. */
const COMPANIES_PER_CONNECTION = 12;
const COMPANY_TIERS = ["standard", "gold", "platinum"];

export async function seedSources(
  tx: Tx,
  volumes: Volumes,
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

  // Every third project has no product: a ticket target owned by a team.
  const projects: SeededProject[] = [];
  const projectRows: Record<string, unknown>[] = [];
  for (let i = 0; i < volumes.sourceProjects; i++) {
    const conn = connections[i % connections.length];
    const hasProduct = i % 3 !== 2;
    const product = products[i % products.length];
    const id = uuidFor("source_project", i);
    projects.push({ id, connectionId: conn.id, hasProduct });
    projectRows.push({
      id,
      source_connection_id: conn.id,
      // Enumerated per connection, so (connection, external_key) is unique.
      external_key: `${480_000 + i}`,
      name: `Seeded project ${i}`,
      product_id: hasProduct ? product.id : null,
      // team_id is required and must match the product's team so the scope
      // checks in `sourceProjectScope` stay coherent.
      team_id: hasProduct ? product.teamId : teams[i % teams.length].id,
      customer_id: chance(rngFor("project", i), 0.2)
        ? customers[i % customers.length].id
        : null,
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
    ],
    projectRows,
  );

  await seedProjectAreas(tx, volumes, projects, components);
  const workItems = await seedWorkItems(
    tx,
    volumes,
    connections,
    projects,
    products,
    customers,
  );
  await seedMessages(tx, volumes, workItems);
  await seedEvents(tx, workItems);
  await seedCustomerRecords(tx, connections);
  await seedLinks(tx, volumes, workItems, projects);

  return { connections, projects, workItems };
}

async function seedProjectAreas(
  tx: Tx,
  volumes: Volumes,
  projects: SeededProject[],
  components: SeededComponent[],
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const perProject = Math.max(
    1,
    Math.ceil(volumes.projectAreas / Math.max(1, projects.length)),
  );
  for (const project of projects) {
    for (let i = 0; i < perProject && rows.length < volumes.projectAreas; i++) {
      const comp = components[(rows.length * 3) % components.length];
      rows.push({
        id: uuidFor("project_area", rows.length),
        source_project_id: project.id,
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
  volumes: Volumes,
  connections: { id: string; slug: string }[],
  projects: SeededProject[],
  products: SeededProduct[],
  customers: SeededCustomer[],
): Promise<SeededWorkItem[]> {
  const knowledgeProjects = projects.filter((p) => p.hasProduct);

  // external_id is a per-connection counter, so (connection, external_id)
  // is unique without needing a conflict clause.
  const counters = new Map<string, number>();
  const workItems: SeededWorkItem[] = [];

  await insertWindowed(
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
      "priority",
      "external_customer_key",
      "raw",
      "source_created_at",
      "source_updated_at",
      "fetched_at",
    ],
    volumes.workItems,
    (i) => {
      const conn = connections[i % connections.length];
      const next = (counters.get(conn.id) ?? 0) + 1;
      counters.set(conn.id, next);
      const externalId = `${next}`;
      const id = uuidFor("work_item", i);

      const rng = rngFor("work_item", i);
      // Drawn from the row's stream, not by `i % list.length`: cycling repeats
      // a few dozen titles across every row, which is all the trigram index
      // then sees. As for the knowledge entries.
      const project = pick(rng, knowledgeProjects);
      const product = pick(rng, products);
      const symptom = pick(rng, SYMPTOMS);
      const errorCode = `E${intBetween(rng, 100, 999)}`;
      const created = pastDate(rng, 540);
      // Drawn in this order whatever order the row lists them in: a draw
      // moved is every later value of the row changed.
      const kind = pick(rng, ["ticket", "issue", "bug", "task"]);
      const context = pick(rng, CONTEXTS);
      const status = pick(rng, STATUSES);
      const hasCustomer = chance(rng, 0.75);
      const observedVersion = `${intBetween(rng, 3, 9)}.${intBetween(rng, 0, 12)}`;
      const priority = intBetween(rng, 1, 4);
      const updated = new Date(
        created.getTime() + intBetween(rng, 0, 72) * 3_600_000,
      );
      workItems.push({
        id,
        connectionId: conn.id,
        externalId,
        status,
        createdAt: created,
        updatedAt: updated,
      });

      return {
        id,
        source_connection_id: conn.id,
        external_id: externalId,
        external_url: `https://example.invalid/${conn.slug}/${externalId}`,
        kind,
        title: `${symptom} on ${product.slug} ${context} (${errorCode})`,
        status,
        external_group_key: `${480_000 + (i % 8)}`,
        source_project_id: project.id,
        product_id: product.id,
        team_id: product.teamId,
        customer_id: hasCustomer ? customers[i % customers.length].id : null,
        observed_version: observedVersion,
        requester: `contact${i % 200}@example.invalid`,
        priority: `${priority}`,
        external_customer_key: `${i % COMPANIES_PER_CONNECTION}`,
        // Capped: a realistic blob dominates the database's size at
        // --scale=large.
        raw: tx.json({ seeded: true, symptom, priority }),
        source_created_at: created,
        source_updated_at: updated,
        // Every seeded item has messages, as one read whole does.
        fetched_at: updated,
      };
    },
  );

  return workItems;
}

async function seedMessages(
  tx: Tx,
  volumes: Volumes,
  workItems: SeededWorkItem[],
): Promise<void> {
  const per = Math.max(
    1,
    Math.floor(volumes.workItemMessages / workItems.length),
  );

  await insertWindowed(
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
    workItems.length * per,
    (i) => {
      const item = workItems[Math.floor(i / per)];
      const step = i % per;
      const rng = rngFor("message", i);
      // A step, an outcome and a detail are composed per message so the
      // follow-ups stay distinct at --scale=large.
      const symptom = pick(rng, SYMPTOMS);
      // The thread quotes its own ticket, the way a real one does. That also
      // keeps a body unique: the composed halves alone repeat at --scale=large.
      const ref = `${item.externalId}`;
      const body =
        step === 0
          ? `${pick(rng, MESSAGE_OPENERS)}: ${symptom}. It shows up ${pick(rng, CONTEXTS)}, and ${pick(rng, IMPACTS)}. Logged as #${ref} against ${intBetween(rng, 3, 9)}.${intBetween(rng, 0, 12)}.`
          : `Update ${step} on #${ref}: ${pick(rng, MESSAGE_STEPS)} - ${pick(rng, MESSAGE_OUTCOMES)}. ${pick(rng, DIAGNOSTICS)}. Seen ${intBetween(rng, 2, 400)} times in the last ${intBetween(rng, 2, 72)} hours.`;

      return {
        id: uuidFor("work_item_message", i),
        work_item_id: item.id,
        // Per-item ordinal: (work_item_id, external_id) is unique.
        external_id: `${step}`,
        author:
          step % 2 === 0 ? "customer@example.invalid" : "agent@tachy.local",
        visibility: chance(rng, 0.2) ? "private" : "public",
        direction: step % 2 === 0 ? "inbound" : "outbound",
        body_text: body,
        created_at: pastDate(rng, 500),
      };
    },
  );
}

/** Each item's opening, and the one change of status that left it where it is. */
async function seedEvents(tx: Tx, workItems: SeededWorkItem[]): Promise<void> {
  const columns = [
    "id",
    "work_item_id",
    "external_id",
    "occurred_at",
    "actor",
    "field",
    "old_value",
    "new_value",
    "origin",
  ];
  await insertWindowed(
    tx,
    "work_item_events",
    columns,
    workItems.length,
    (i) => ({
      id: uuidFor("work_item_event_created", i),
      work_item_id: workItems[i].id,
      external_id: "created",
      occurred_at: workItems[i].createdAt,
      actor: null,
      field: "created",
      old_value: null,
      new_value: null,
      origin: "source",
    }),
  );
  const moved = workItems.filter((item) => item.status !== "open");
  await insertWindowed(tx, "work_item_events", columns, moved.length, (i) => ({
    id: uuidFor("work_item_event_status", i),
    work_item_id: moved[i].id,
    external_id: `observed:status:${moved[i].updatedAt.toISOString()}`,
    occurred_at: moved[i].updatedAt,
    actor: null,
    field: "status",
    old_value: "open",
    new_value: moved[i].status,
    origin: "observed",
  }));
}

async function seedCustomerRecords(
  tx: Tx,
  connections: { id: string; slug: string }[],
): Promise<void> {
  const rows = connections.flatMap((conn, c) =>
    Array.from({ length: COMPANIES_PER_CONNECTION }, (_, k) => {
      const name = `Company ${k + 1} (${conn.slug})`;
      const rng = rngFor(
        "source_customer_record",
        c * COMPANIES_PER_CONNECTION + k,
      );
      return {
        id: uuidFor("source_customer_record", c * COMPANIES_PER_CONNECTION + k),
        source_connection_id: conn.id,
        external_id: `${k}`,
        name,
        record: tx.json({ id: k, name, tier: pick(rng, COMPANY_TIERS) }),
      };
    }),
  );
  await insertRows(
    tx,
    "source_customer_records",
    ["id", "source_connection_id", "external_id", "name", "record"],
    rows,
  );
}

/**
 * Two disjoint row shapes. The schema has one partial unique index per shape,
 * and the CHECK needs at least one target; keeping "points at an ingested item"
 * and "points at an id not ingested" strictly separate means neither index can
 * ever see the other's rows.
 */
async function seedLinks(
  tx: Tx,
  volumes: Volumes,
  workItems: SeededWorkItem[],
  projects: SeededProject[],
): Promise<void> {
  if (workItems.length < 2) return;
  const trackers = projects.filter((p) => !p.hasProduct);
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (
    let i = 0;
    i < volumes.workItemLinks * 2 && rows.length < volumes.workItemLinks;
    i++
  ) {
    const rng = rngFor("link", i);
    const from = workItems[i % workItems.length];
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
      const to = workItems[(i * 7919 + 1) % workItems.length];
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

/** People who follow on the board, and how many items each follows. */
const FOLLOWERS = 5;
const FOLLOWS_EACH = 3;

/**
 * A few people follow a few items each, some read up to a revision. Each
 * person's first follow also writes back to another item, as a flow sets up.
 */
export async function seedFollows(
  tx: Tx,
  users: SeededUser[],
  workItems: SeededWorkItem[],
): Promise<void> {
  if (!workItems.length) return;
  const rows: Record<string, unknown>[] = [];
  users.slice(0, FOLLOWERS).forEach((user, u) => {
    for (let k = 0; k < FOLLOWS_EACH; k++) {
      const item = workItems[(u * 37 + k * 11) % workItems.length];
      if (
        rows.some(
          (row) =>
            row.user_id === user.id && row.external_id === item.externalId,
        )
      )
        continue;
      rows.push({
        user_id: user.id,
        source_connection_id: item.connectionId,
        external_id: item.externalId,
        seen_rev: k === 0 ? null : k + u,
      });
    }
  });
  await insertRows(
    tx,
    "work_item_follows",
    ["user_id", "source_connection_id", "external_id", "seen_rev"],
    rows,
  );
  const notes = rows
    .filter((row) => row.seen_rev === null)
    .map((row, i) => ({
      user_id: row.user_id,
      source_connection_id: row.source_connection_id,
      external_id: row.external_id,
      work_item_id: workItems[(i * 13 + 5) % workItems.length].id,
    }));
  await insertRows(
    tx,
    "work_item_follow_notes",
    ["user_id", "source_connection_id", "external_id", "work_item_id"],
    notes,
  );
}
