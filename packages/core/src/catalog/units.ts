import type { CustomerUnitRow, ResolvedFact } from "@tachy/contract";
import { sql } from "../infra/db";
import { nearestSlugsHint } from "./nearest";
import { wouldCycle, type ParentColumn } from "../infra/hierarchy";
import { badInput, conflict, notFound } from "../infra/errors";
import { assertNoSecrets } from "../compliance/redaction";
import { assertUnitFitsBlueprint } from "./blueprints";
import { linkCustomerProduct } from "./customer-products";

export type { CustomerUnitRow, ResolvedFact };

/**
 * Not `getCustomerIdBySlug` from ./customers: that module imports `resolveUnit`
 * from here, and a two-line query keeps the import one-way.
 */
async function customerIdOf(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    select id from customers where slug = ${slug}
  `;
  if (!row) throw badInput(`unknown customer '${slug}'`);
  return row.id;
}

export interface CustomerUnitInput {
  customerSlug: string;
  slug: string;
  name: string;
  kind: string;
  /** The product whose setup the unit belongs to. Null or absent: a general unit. */
  productId?: string | null;
  parentSlug?: string | null;
  templateSlug?: string | null;
  aliases?: string[];
  notes?: string | null;
}

export interface CustomerUnitPatch {
  name?: string;
  kind?: string;
  productId?: string | null;
  parentSlug?: string | null;
  templateSlug?: string | null;
  aliases?: string[];
  notes?: string | null;
}

/**
 * Looser than the contract's SLUG_RE, and case-insensitive: unit slugs are
 * transcribed off equipment labels (TLC191, acme.eu), not typed as identifiers.
 */
const UNIT_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

const UNIT_COLUMNS = sql`
  u.id, u.customer_id, u.product_id, p.slug as product_slug, u.parent_id,
  u.template_id, u.kind, u.slug, u.name, u.aliases, u.notes
`;

export async function listCustomerUnits(
  customerId: string,
): Promise<CustomerUnitRow[]> {
  return sql<CustomerUnitRow[]>`
    select ${UNIT_COLUMNS}
    from customer_units u left join products p on p.id = u.product_id
    where u.customer_id = ${customerId}
    order by u.kind, u.slug
  `;
}

export async function getUnitSlug(
  unitId: string | null,
): Promise<string | null> {
  if (!unitId) return null;
  const [row] = await sql<{ slug: string }[]>`
    select slug from customer_units where id = ${unitId}
  `;
  return row?.slug ?? null;
}

/**
 * Slug, then alias, then a trigram-ranked hint - the same ladder
 * resolveComponentStrict and resolveCustomer offer, because a line is referred
 * to by whatever name the person at the site uses for it.
 */
export async function resolveUnit(
  customerId: string,
  slugOrAlias: string,
): Promise<CustomerUnitRow> {
  const [row] = await sql<CustomerUnitRow[]>`
    select ${UNIT_COLUMNS}
    from customer_units u left join products p on p.id = u.product_id
    where u.customer_id = ${customerId}
      and (u.slug = ${slugOrAlias}
           or exists (select 1 from unnest(u.aliases) a where lower(a) = lower(${slugOrAlias})))
    order by (u.slug = ${slugOrAlias}) desc
    limit 1
  `;
  if (row) return row;

  const hint = await nearestSlugsHint("customer_units", slugOrAlias, {
    column: "customer_id",
    id: customerId,
  });
  throw badInput(
    `unknown unit '${slugOrAlias}' for this customer.${hint} call list_customer_units, or add_customer_unit first`,
  );
}

/**
 * Throws when an item of one product is filed under a unit of another's setup.
 * An item with no product, or a general unit, fits anywhere.
 */
export function assertUnitInProduct(
  unit: Pick<CustomerUnitRow, "slug" | "product_id" | "product_slug">,
  productId: string | null,
): void {
  if (!unit.product_id || !productId || unit.product_id === productId) return;
  throw badInput(
    `'${unit.slug}' is part of the ${unit.product_slug} setup, so an item of another product cannot be filed under it`,
  );
}

/** Walking up from `from` must not arrive back at `at`, on either edge. */
async function assertNoCycle(
  at: string,
  from: string,
  column: ParentColumn,
  label: string,
): Promise<void> {
  if (await wouldCycle("customer_units", at, from, column))
    throw badInput(`'${label}' already sits under this unit; that would cycle`);
}

export async function addCustomerUnit(input: CustomerUnitInput) {
  if (!UNIT_SLUG_RE.test(input.slug))
    throw badInput(
      `invalid unit slug '${input.slug}': letters, digits, dot, dash and underscore only`,
    );
  assertNoSecrets({ notes: input.notes });
  const customerId = await customerIdOf(input.customerSlug);
  const productId = input.productId ?? null;
  const parentId = input.parentSlug
    ? (await resolveUnit(customerId, input.parentSlug)).id
    : null;
  const templateId = input.templateSlug
    ? (await resolveUnit(customerId, input.templateSlug)).id
    : null;

  // The insert cannot ring; the `do update` half re-parents an existing row,
  // and both self-references can close one.
  if (parentId || templateId) {
    const [existing] = await sql`
      select id from customer_units
      where customer_id = ${customerId} and slug = ${input.slug}
    `;
    if (existing) {
      if (parentId)
        await assertNoCycle(
          existing.id,
          parentId,
          "parent_id",
          input.parentSlug!,
        );
      if (templateId)
        await assertNoCycle(
          existing.id,
          templateId,
          "template_id",
          input.templateSlug!,
        );
    }
  }

  return sql.begin(async (tx) => {
    await assertUnitFitsBlueprint(tx, {
      productId,
      kind: input.kind,
      parentId,
      templateId,
    });
    const [row] = await tx`
      insert into customer_units
        (customer_id, product_id, parent_id, template_id, kind, slug, name, aliases, notes)
      values
        (${customerId}, ${productId}, ${parentId}, ${templateId}, ${input.kind}, ${input.slug},
         ${input.name}, ${input.aliases ?? []}, ${input.notes ?? null})
      on conflict (customer_id, slug) do update set
        product_id  = excluded.product_id,
        parent_id   = excluded.parent_id,
        template_id = excluded.template_id,
        kind        = excluded.kind,
        name        = excluded.name,
        aliases     = excluded.aliases,
        notes       = excluded.notes
      returning id, slug, name, kind
    `;
    if (productId) await linkCustomerProduct(customerId, productId, { db: tx });
    return row;
  });
}

async function patchedEdge(
  customerId: string,
  current: CustomerUnitRow,
  slug: string | null | undefined,
  column: "parent_id" | "template_id",
): Promise<string | null> {
  if (!slug) return null;
  const target = (await resolveUnit(customerId, slug)).id;
  if (target === current.id)
    throw badInput(
      column === "parent_id"
        ? `'${current.slug}' cannot contain itself`
        : `'${current.slug}' cannot be its own template`,
    );
  await assertNoCycle(current.id, target, column, slug);
  return target;
}

export async function updateCustomerUnit(
  customerId: string,
  slug: string,
  patch: CustomerUnitPatch,
) {
  assertNoSecrets({ notes: patch.notes });
  const current = await resolveUnit(customerId, slug);
  const parentId =
    "parentSlug" in patch
      ? await patchedEdge(customerId, current, patch.parentSlug, "parent_id")
      : current.parent_id;
  const templateId =
    "templateSlug" in patch
      ? await patchedEdge(
          customerId,
          current,
          patch.templateSlug,
          "template_id",
        )
      : current.template_id;
  const productId =
    "productId" in patch ? (patch.productId ?? null) : current.product_id;
  const kind = patch.kind ?? current.kind;

  return sql.begin(async (tx) => {
    await assertUnitFitsBlueprint(tx, {
      productId,
      kind,
      parentId,
      templateId,
    });
    const [row] = await tx`
      update customer_units set
        name        = ${patch.name ?? current.name},
        kind        = ${kind},
        product_id  = ${productId},
        parent_id   = ${parentId},
        template_id = ${templateId},
        aliases     = ${patch.aliases ?? current.aliases},
        notes       = ${"notes" in patch ? (patch.notes ?? null) : current.notes}
      where id = ${current.id}
      returning id, slug, name, kind
    `;
    if (productId) await linkCustomerProduct(customerId, productId, { db: tx });
    return row;
  });
}

/** What is filed under a unit, which a delete would un-file. */
export type FiledUnder = {
  work_items: number;
  entries: number;
  docs: number;
};

export const filedTotal = (filed: Record<string, number>) =>
  Object.values(filed).reduce((sum, n) => sum + n, 0);

/** Names each count that is not zero, for the refusal a guard throws. */
export function filedText(filed: Record<string, number>): string {
  return Object.entries(filed)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${n} ${what.replaceAll("_", " ")}`)
    .join(", ");
}

async function filedUnderUnit(unitId: string): Promise<FiledUnder> {
  const [row] = await sql<FiledUnder[]>`
    select
      (select count(*)::int from work_items where customer_unit_id = ${unitId}) as work_items,
      (select count(*)::int from knowledge_entries where customer_unit_id = ${unitId}) as entries,
      (select count(*)::int from reference_docs where customer_unit_id = ${unitId}) as docs
  `;
  return row;
}

/**
 * Refused while tickets, entries or docs are filed under the unit: deleting it
 * would un-file them silently. Children move up to the unit's own parent rather
 * than cascading, so removing a middle level flattens the setup instead of
 * deleting every line beneath it. Units that follow it lose their template, and
 * its own facts go, since they described a place that no longer exists.
 */
export async function deleteCustomerUnit(customerId: string, slug: string) {
  const current = await resolveUnit(customerId, slug);
  const filed = await filedUnderUnit(current.id);
  if (filedTotal(filed) > 0)
    throw conflict(
      `'${current.slug}' still has ${filedText(filed)} filed under it: file them elsewhere first`,
      { filed },
    );
  return sql.begin(async (tx) => {
    await tx`
      update customer_units set parent_id = ${current.parent_id}
      where parent_id = ${current.id}
    `;
    await tx`
      update customer_units set template_id = null
      where template_id = ${current.id}
    `;
    await tx`delete from customer_facts where unit_id = ${current.id}`;
    await tx`delete from customer_units where id = ${current.id}`;
    return { deleted: current.slug };
  });
}

/**
 * Every fact that applies to one unit, most specific first, each carrying where
 * it came from: the unit's own, its template's, then the same pair for each
 * parent up to the root, then the customer's. Rank is `depth * 2` for a unit in
 * the containment chain and `depth * 2 + 1` for its template, so a template
 * loses to the unit that follows it and beats anything further up.
 */
export async function resolveUnitFacts(
  unitId: string,
): Promise<ResolvedFact[]> {
  const [unit] = await sql`
    select customer_id from customer_units where id = ${unitId}
  `;
  if (!unit) throw notFound(`unknown customer unit '${unitId}'`);

  return sql<ResolvedFact[]>`
    with recursive chain as (
      select id, parent_id, template_id, 0 as depth
      from customer_units where id = ${unitId}
      union all
      select u.id, u.parent_id, u.template_id, chain.depth + 1
      from customer_units u join chain on u.id = chain.parent_id
    ),
    ranked as (
      select id as unit_id, depth * 2 as rank from chain
      union all
      select template_id, depth * 2 + 1 from chain where template_id is not null
    )
    select distinct on (f.kind, f.label)
      f.kind, f.label, f.value, f.notes, f.source,
      u.slug as origin_slug, u.name as origin_name, u.kind as origin_kind,
      (f.unit_id is null or f.unit_id <> ${unitId}) as inherited
    from customer_facts f
    left join ranked r on r.unit_id = f.unit_id
    left join customer_units u on u.id = f.unit_id
    where f.customer_id = ${unit.customer_id}
      and (f.unit_id is null or r.unit_id is not null)
    order by f.kind, f.label, coalesce(r.rank, 1000000)
  `;
}
