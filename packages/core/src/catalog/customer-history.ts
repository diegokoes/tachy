/**
 * A customer's history. Every write to the customer, the products it uses, its
 * units, facts and component links records the row as it was before and after,
 * inside the write's own transaction. One action is one batch; restoring a
 * batch writes its `before` rows back, newest first, as a batch of its own.
 */
import { randomUUID } from "node:crypto";
import type { ParameterOrJSON } from "postgres";
import type {
  CustomerChange,
  CustomerChangeBatch,
  CustomerChangeRecord,
  DeletedCustomer,
} from "@tachy/contract";
import { sql, jsonb, type Db } from "../infra/db";
import { conflict, notFound } from "../infra/errors";
import { UNKNOWN_ACTOR, type ActorRef } from "../library/revisions";

export interface ChangeBatch {
  id: string;
  actor: ActorRef;
  /** The batch this one undoes. */
  restores?: string;
}

export function newBatch(
  actor: ActorRef = UNKNOWN_ACTOR,
  restores?: string,
): ChangeBatch {
  return { id: randomUUID(), actor, ...(restores ? { restores } : {}) };
}

/** A write under way: the transaction and the batch a nested write joins. */
export interface WriteContext {
  db: Db;
  batch: ChangeBatch;
}

/** Runs `write` in a transaction of its own, as one batch. */
export function inNewBatch<T>(
  actor: ActorRef | undefined,
  write: (ctx: WriteContext) => Promise<T>,
): Promise<T> {
  const batch = newBatch(actor);
  return sql.begin((db) => write({ db, batch })) as Promise<T>;
}

type Row = Record<string, unknown>;

/** Column values that pick out one row. */
export type RecordKey = Record<string, string | null>;

const RECORD_TABLES: Record<CustomerChangeRecord, string> = {
  customer: "customers",
  product: "customer_products",
  unit: "customer_units",
  fact: "customer_facts",
  component: "customer_components",
};

/** What a link row is keyed by beside its customer, which is its record id. */
const LINK_TARGET: Partial<Record<CustomerChangeRecord, string>> = {
  product: "product_id",
  component: "component_id",
};

/** The key a stored row is found again by: its id, or a link's two ends. */
function keyOf(record: CustomerChangeRecord, row: Row): RecordKey {
  const target = LINK_TARGET[record];
  if (!target) return { id: row.id as string };
  return {
    customer_id: row.customer_id as string,
    [target]: row[target] as string,
  };
}

const recordIdOf = (record: CustomerChangeRecord, row: Row) =>
  row[LINK_TARGET[record] ?? "id"] as string;

const customerIdOf = (record: CustomerChangeRecord, row: Row) =>
  (record === "customer" ? row.id : row.customer_id) as string;

/** `is not distinct from`, so a null in the key matches a null column. */
function matching(db: Db, key: RecordKey) {
  return Object.entries(key)
    .map(([column, value]) => db`${db(column)} is not distinct from ${value}`)
    .reduce((all, condition) => db`${all} and ${condition}`);
}

async function readRecord(
  db: Db,
  record: CustomerChangeRecord,
  key: RecordKey,
): Promise<Row | null> {
  const [row] = await db<Row[]>`
    select * from ${db(RECORD_TABLES[record])} where ${matching(db, key)}
  `;
  return row ? { ...row } : null;
}

/** Timestamps a write moves without changing what the row says. */
const BOOKKEEPING = new Set(["created_at", "updated_at"]);

function sameContent(before: Row | null, after: Row | null): boolean {
  if (!before || !after) return before === after;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].every(
    (key) =>
      BOOKKEEPING.has(key) ||
      JSON.stringify(before[key] ?? null) ===
        JSON.stringify(after[key] ?? null),
  );
}

async function recordCustomerChange(
  { db, batch }: WriteContext,
  change: {
    record: CustomerChangeRecord;
    before: Row | null;
    after: Row | null;
  },
): Promise<void> {
  if (sameContent(change.before, change.after)) return;
  const row = (change.after ?? change.before)!;
  await db`
    insert into customer_changes
      (batch_id, customer_id, record, record_id, before, after, user_id, actor, turn_id, restores)
    values
      (${batch.id}, ${customerIdOf(change.record, row)}, ${change.record},
       ${recordIdOf(change.record, row)},
       ${change.before ? jsonb(change.before) : null},
       ${change.after ? jsonb(change.after) : null},
       ${batch.actor.userId ?? null}, ${batch.actor.actor},
       ${batch.actor.turnId ?? null}, ${batch.restores ?? null})
  `;
}

/**
 * Runs `write` against the one record `key` picks out, and records the row as
 * it was before and after. `key` may be a natural key the write fills in, such
 * as a unit's (customer, slug) before its insert.
 */
export async function trackRecord<T>(
  ctx: WriteContext,
  record: CustomerChangeRecord,
  key: RecordKey,
  write: () => Promise<T>,
): Promise<T> {
  const before = await readRecord(ctx.db, record, key);
  const result = await write();
  const after = await readRecord(ctx.db, record, key);
  await recordCustomerChange(ctx, { record, before, after });
  return result;
}

/** Records the deletion of rows the caller is about to delete. */
export async function recordDeleted(
  ctx: WriteContext,
  record: CustomerChangeRecord,
  rows: Row[],
): Promise<void> {
  for (const row of rows)
    await recordCustomerChange(ctx, {
      record,
      before: { ...row },
      after: null,
    });
}

/** How many batches a history read returns, newest first. */
const HISTORY_BATCHES = 50;

export async function listCustomerChanges(
  customerId: string,
): Promise<CustomerChangeBatch[]> {
  const rows = await sql<
    (CustomerChange & {
      batch_id: string;
      at: Date;
      actor: CustomerChangeBatch["actor"];
      user_email: string | null;
      user_name: string | null;
      restores: string | null;
    })[]
  >`
    with recent as (
      select batch_id, max(id) as last_id from customer_changes
      where customer_id = ${customerId}
      group by batch_id
      order by last_id desc
      limit ${HISTORY_BATCHES}
    )
    select c.batch_id, c.created_at as at, c.actor, u.email as user_email,
           u.display_name as user_name, c.restores,
           c.record, c.record_id, c.before, c.after
    from customer_changes c
    join recent on recent.batch_id = c.batch_id
    left join users u on u.id = c.user_id
    order by recent.last_id desc, c.id
  `;
  const batches = new Map<string, CustomerChangeBatch>();
  for (const row of rows) {
    const batch = batches.get(row.batch_id) ?? {
      batch_id: row.batch_id,
      at: row.at.toISOString(),
      actor: row.actor,
      user_email: row.user_email,
      user_name: row.user_name,
      restores: row.restores,
      changes: [],
    };
    batch.changes.push({
      record: row.record,
      record_id: row.record_id,
      before: row.before,
      after: row.after,
    });
    batches.set(row.batch_id, batch);
  }
  return [...batches.values()];
}

/** Customers deleted and not brought back since, newest first, each with the batch a restore takes. */
export async function listDeletedCustomers(): Promise<DeletedCustomer[]> {
  const rows = await sql<(Omit<DeletedCustomer, "at"> & { at: Date })[]>`
    select c.batch_id, c.created_at as at, c.before->>'slug' as slug,
           c.before->>'name' as name, u.email as user_email,
           u.display_name as user_name
    from customer_changes c
    left join users u on u.id = c.user_id
    where c.record = 'customer' and c.after is null
      and not exists (select 1 from customers cu where cu.id = c.customer_id)
    order by c.id desc
    limit ${HISTORY_BATCHES}
  `;
  return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
}

interface StoredChange extends CustomerChange {
  id: string;
  customer_id: string;
}

async function batchChanges(batchId: string): Promise<StoredChange[]> {
  const changes = await sql<StoredChange[]>`
    select id::text, customer_id, record, record_id, before, after
    from customer_changes where batch_id = ${batchId}
    order by id
  `;
  if (!changes.length) throw notFound(`history batch '${batchId}' not found`);
  return [...changes];
}

/** What a restore of the batch needs the rights of: products, and the customer's own record. */
export interface BatchScope {
  customerId: string;
  productIds: string[];
  touchesCustomer: boolean;
}

/** A unit's product, from the batch's own snapshots or the unit as it stands. */
async function unitProduct(
  unitId: string,
  changes: StoredChange[],
): Promise<string | null> {
  const snapshot = changes.find(
    (c) => c.record === "unit" && c.record_id === unitId,
  );
  const row = snapshot?.before ?? snapshot?.after;
  if (row) return (row.product_id as string | null) ?? null;
  const [unit] = await sql<{ product_id: string | null }[]>`
    select product_id from customer_units where id = ${unitId}
  `;
  return unit?.product_id ?? null;
}

async function changeProduct(
  change: StoredChange,
  changes: StoredChange[],
): Promise<string | null> {
  const row = (change.before ?? change.after)!;
  if (change.record === "product") return change.record_id;
  if (change.record === "unit") return (row.product_id as string) ?? null;
  if (change.record === "fact")
    return row.unit_id ? unitProduct(row.unit_id as string, changes) : null;
  if (change.record === "component") {
    const [component] = await sql<{ product_id: string }[]>`
      select product_id from components where id = ${change.record_id}
    `;
    return component?.product_id ?? null;
  }
  return null;
}

export async function batchScope(batchId: string): Promise<BatchScope> {
  const changes = await batchChanges(batchId);
  const productIds = new Set<string>();
  let touchesCustomer = false;
  for (const change of changes) {
    const productId = await changeProduct(change, changes);
    if (productId) productIds.add(productId);
    else touchesCustomer = true;
  }
  return {
    customerId: changes[0].customer_id,
    productIds: [...productIds],
    touchesCustomer,
  };
}

/**
 * Throws when a record of the batch has changed since. An undone batch no
 * longer counts, nor does the undo of a batch newer than this one: undoing the
 * newest first and then the one before it works like an undo stack.
 */
async function assertNothingNewer(batchId: string): Promise<void> {
  const [newer] = await sql<
    { record: string; created_at: Date; batch_id: string }[]
  >`
    select n.record, n.created_at, n.batch_id
    from customer_changes c
    join customer_changes n
      on n.customer_id = c.customer_id and n.record = c.record
     and n.record_id = c.record_id and n.id > c.id and n.batch_id <> c.batch_id
    where c.batch_id = ${batchId}
      and not exists (
        select 1 from customer_changes undo where undo.restores = n.batch_id)
      and not exists (
        select 1 from customer_changes undone
        where undone.batch_id = n.restores and undone.record = c.record
          and undone.record_id = c.record_id and undone.id > c.id)
    order by n.id desc
    limit 1
  `;
  if (newer)
    throw conflict(
      `that ${newer.record} changed again on ${newer.created_at.toISOString()}: restore the newer change first`,
      { newer_batch: newer.batch_id },
    );
}

/** The edges a restored unit points at, set once every unit of the batch is back. */
interface DeferredEdges {
  id: string;
  parent_id: string | null;
  template_id: string | null;
}

async function unitExists(db: Db, unitId: unknown): Promise<boolean> {
  if (!unitId) return true;
  const [row] = await db`
    select 1 from customer_units where id = ${unitId as string}
  `;
  return !!row;
}

/** Rows a delete of the record would take with it or un-file. */
async function dependentCount(
  db: Db,
  record: CustomerChangeRecord,
  id: string,
): Promise<number> {
  if (record === "customer") {
    const [row] = await db<{ n: number }[]>`
      select
        (select count(*) from customer_units where customer_id = ${id}) +
        (select count(*) from customer_facts where customer_id = ${id}) +
        (select count(*) from customer_products where customer_id = ${id}) +
        (select count(*) from customer_components where customer_id = ${id}) +
        (select count(*) from work_items where customer_id = ${id}) +
        (select count(*) from knowledge_entries where customer_id = ${id}) +
        (select count(*) from reference_docs where customer_id = ${id}) +
        (select count(*) from repos where customer_id = ${id}) +
        (select count(*) from source_projects where customer_id = ${id}) as n
    `;
    return Number(row.n);
  }
  if (record === "unit") {
    const [row] = await db<{ n: number }[]>`
      select
        (select count(*) from customer_units
          where parent_id = ${id} or template_id = ${id}) +
        (select count(*) from customer_facts where unit_id = ${id}) +
        (select count(*) from work_items where customer_unit_id = ${id}) +
        (select count(*) from knowledge_entries where customer_unit_id = ${id}) +
        (select count(*) from reference_docs where customer_unit_id = ${id}) as n
    `;
    return Number(row.n);
  }
  return 0;
}

/** Undoing an add deletes the record, refused while anything hangs off it. */
async function deleteAdded(
  db: Db,
  change: StoredChange,
  key: RecordKey,
): Promise<void> {
  if (await dependentCount(db, change.record, change.record_id))
    throw conflict(
      `that ${change.record} has more under it since it was added: remove that first`,
    );
  await db`
    delete from ${db(RECORD_TABLES[change.record])} where ${matching(db, key)}
  `;
}

/** A unit comes back without an edge to a unit that is not back yet. */
function withoutMissingEdges(
  row: Row,
  present: { parent: boolean; template: boolean },
  deferred: DeferredEdges[],
): Row {
  if (present.parent && present.template) return row;
  deferred.push({
    id: row.id as string,
    parent_id: (row.parent_id as string) ?? null,
    template_id: (row.template_id as string) ?? null,
  });
  return {
    ...row,
    ...(present.parent ? {} : { parent_id: null }),
    ...(present.template ? {} : { template_id: null }),
  };
}

async function writeBack(
  ctx: WriteContext,
  change: StoredChange,
  deferred: DeferredEdges[],
): Promise<void> {
  const { db } = ctx;
  const key = keyOf(change.record, (change.after ?? change.before)!);
  await trackRecord(ctx, change.record, key, async () => {
    if (!change.before) return deleteAdded(db, change, key);
    const row =
      change.record === "unit"
        ? withoutMissingEdges(
            change.before,
            {
              parent: await unitExists(db, change.before.parent_id),
              template: await unitExists(db, change.before.template_id),
            },
            deferred,
          )
        : change.before;
    const values = row as Record<string, ParameterOrJSON<never>>;
    const columns = Object.keys(values);
    await db`
        insert into ${db(RECORD_TABLES[change.record])} ${db(values, columns)}
        on conflict (${db(Object.keys(key))}) do update set ${db(values, columns)}
      `;
  });
}

/**
 * Undoes a batch: each record goes back to what it was before, newest change
 * first, as a batch of its own. Refused when any of them has changed since.
 */
export async function restoreCustomerBatch(
  batchId: string,
  actor: ActorRef = UNKNOWN_ACTOR,
) {
  const changes = await batchChanges(batchId);
  await assertNothingNewer(batchId);
  const batch = newBatch(actor, batchId);
  await sql.begin(async (db) => {
    const ctx = { db, batch };
    const deferred: DeferredEdges[] = [];
    for (const change of [...changes].reverse())
      await writeBack(ctx, change, deferred);
    for (const edges of deferred)
      await trackRecord(
        ctx,
        "unit",
        { id: edges.id },
        () => db`
          update customer_units
          set parent_id = ${edges.parent_id}, template_id = ${edges.template_id}
          where id = ${edges.id}
        `,
      );
  });
  return { restored: batchId, batch: batch.id, changes: changes.length };
}
