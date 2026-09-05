import { sql } from "../infra/db";
import { wouldCycle, type ParentColumn } from "../infra/hierarchy";
import { badInput, notFound } from "../infra/errors";

/**
 * Deliberately not `getCustomerIdBySlug` from ./customers: that module imports
 * resolveUnit from here, and one-way is worth a two-line query.
 */
async function customerIdOf(slug: string): Promise<string> {
  const [row] = await sql`select id from customers where slug = ${slug}`;
  if (!row) throw badInput(`Unknown customer '${slug}'.`);
  return row.id as string;
}

export interface CustomerUnitRow {
  id: string;
  customer_id: string;
  parent_id: string | null;
  profile_id: string | null;
  kind: string;
  slug: string;
  name: string;
  aliases: string[];
  notes: string | null;
}

export interface CustomerUnitInput {
  customerSlug: string;
  slug: string;
  name: string;
  kind: string;
  parentSlug?: string | null;
  profileSlug?: string | null;
  aliases?: string[];
  notes?: string | null;
}

export interface CustomerUnitPatch {
  name?: string;
  kind?: string;
  parentSlug?: string | null;
  profileSlug?: string | null;
  aliases?: string[];
  notes?: string | null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export async function listCustomerUnits(
  customerId: string,
): Promise<CustomerUnitRow[]> {
  return sql`
    select id, customer_id, parent_id, profile_id, kind, slug, name, aliases, notes
    from customer_units where customer_id = ${customerId}
    order by kind, slug
  ` as Promise<CustomerUnitRow[]>;
}

/**
 * Slug, then alias, then a trigram-ranked hint — the same ladder
 * resolveComponentStrict and resolveCustomer offer, because a line is referred
 * to by whatever name the person at the site uses for it.
 */
export async function resolveUnit(
  customerId: string,
  slugOrAlias: string,
): Promise<CustomerUnitRow> {
  const [row] = await sql`
    select id, customer_id, parent_id, profile_id, kind, slug, name, aliases, notes
    from customer_units
    where customer_id = ${customerId}
      and (slug = ${slugOrAlias}
           or exists (select 1 from unnest(aliases) a where lower(a) = lower(${slugOrAlias})))
    order by (slug = ${slugOrAlias}) desc
    limit 1
  `;
  if (row) return row as CustomerUnitRow;

  const nearest = await sql`
    select slug from customer_units
    where customer_id = ${customerId}
    order by greatest(
      similarity(slug, ${slugOrAlias}),
      similarity(name, ${slugOrAlias}),
      coalesce((select max(similarity(a, ${slugOrAlias})) from unnest(aliases) a), 0)
    ) desc
    limit 5
  `;
  const hint = nearest.length
    ? ` Nearest matches: ${nearest.map((r) => `'${r.slug}'`).join(", ")}.`
    : "";
  throw badInput(
    `Unknown unit '${slugOrAlias}' for this customer.${hint} Call list_customer_units, or add_customer_unit first.`,
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
    throw badInput(
      `'${label}' already sits under this unit — that would cycle`,
    );
}

export async function addCustomerUnit(i: CustomerUnitInput) {
  if (!SLUG_RE.test(i.slug))
    throw badInput(
      `Invalid unit slug '${i.slug}' — letters, digits, dot, dash and underscore.`,
    );
  const customerId = await customerIdOf(i.customerSlug);
  const parentId = i.parentSlug
    ? (await resolveUnit(customerId, i.parentSlug)).id
    : null;
  const profileId = i.profileSlug
    ? (await resolveUnit(customerId, i.profileSlug)).id
    : null;

  // The insert cannot ring; the `do update` half re-parents an existing row,
  // and both self-references can close one.
  if (parentId || profileId) {
    const [existing] = await sql`
      select id from customer_units
      where customer_id = ${customerId} and slug = ${i.slug}
    `;
    if (existing) {
      if (parentId)
        await assertNoCycle(existing.id, parentId, "parent_id", i.parentSlug!);
      if (profileId)
        await assertNoCycle(
          existing.id,
          profileId,
          "profile_id",
          i.profileSlug!,
        );
    }
  }

  const [row] = await sql`
    insert into customer_units
      (customer_id, parent_id, profile_id, kind, slug, name, aliases, notes)
    values
      (${customerId}, ${parentId}, ${profileId}, ${i.kind}, ${i.slug}, ${i.name},
       ${i.aliases ?? []}, ${i.notes ?? null})
    on conflict (customer_id, slug) do update set
      parent_id  = excluded.parent_id,
      profile_id = excluded.profile_id,
      kind       = excluded.kind,
      name       = excluded.name,
      aliases    = excluded.aliases,
      notes      = excluded.notes
    returning id, slug, name, kind
  `;
  return row;
}

export async function updateCustomerUnit(
  customerId: string,
  slug: string,
  patch: CustomerUnitPatch,
) {
  const current = await resolveUnit(customerId, slug);

  let parentId = current.parent_id;
  if ("parentSlug" in patch) {
    parentId = patch.parentSlug
      ? (await resolveUnit(customerId, patch.parentSlug)).id
      : null;
    if (parentId === current.id)
      throw badInput(`'${slug}' cannot contain itself`);
    if (parentId)
      await assertNoCycle(current.id, parentId, "parent_id", patch.parentSlug!);
  }

  let profileId = current.profile_id;
  if ("profileSlug" in patch) {
    profileId = patch.profileSlug
      ? (await resolveUnit(customerId, patch.profileSlug)).id
      : null;
    if (profileId === current.id)
      throw badInput(`'${slug}' cannot be its own profile`);
    if (profileId)
      await assertNoCycle(
        current.id,
        profileId,
        "profile_id",
        patch.profileSlug!,
      );
  }

  const [row] = await sql`
    update customer_units set
      name       = ${patch.name ?? current.name},
      kind       = ${patch.kind ?? current.kind},
      parent_id  = ${parentId},
      profile_id = ${profileId},
      aliases    = ${patch.aliases ?? current.aliases},
      notes      = ${"notes" in patch ? (patch.notes ?? null) : current.notes}
    where id = ${current.id}
    returning id, slug, name, kind
  `;
  return row;
}

/**
 * Children are re-parented onto the deleted unit's own parent rather than
 * cascading: removing a middle level of an estate should flatten it, not delete
 * every line beneath it. Facts attached to the unit itself do go, since they
 * described a place that no longer exists.
 */
export async function deleteCustomerUnit(customerId: string, slug: string) {
  const current = await resolveUnit(customerId, slug);
  return sql.begin(async (tx) => {
    await tx`
      update customer_units set parent_id = ${current.parent_id}
      where parent_id = ${current.id}
    `;
    await tx`delete from customer_units where id = ${current.id}`;
    return { deleted: current.slug };
  });
}

export interface ResolvedFact {
  kind: string;
  label: string;
  value: string;
  notes: string | null;
  source: string | null;
  /** Null when the fact is true of the whole customer rather than a unit. */
  origin_slug: string | null;
  origin_name: string | null;
  origin_kind: string | null;
  /** True when it came from somewhere above, not from the unit itself. */
  inherited: boolean;
}

/**
 * Every fact that applies to one unit, most-specific first, each carrying where
 * it came from. The precedence ladder:
 *
 *     the unit's own facts
 *       -> the unit's profile's
 *         -> its parent's
 *           -> its parent's profile's
 *             -> ... up to the root
 *               -> the customer's
 *
 * The origin is the point: it lets an answer say "true of every line on layout
 * 3" instead of "true of TLC191", which is the difference between a fact a
 * reader can generalise and one they cannot.
 *
 * Rank is `depth * 2` for a unit in the containment chain and `depth * 2 + 1`
 * for that unit's profile, so a profile always loses to the unit that names it
 * and beats anything further up.
 */
export async function resolveUnitFacts(
  unitId: string,
): Promise<ResolvedFact[]> {
  const [unit] = await sql`
    select customer_id from customer_units where id = ${unitId}
  `;
  if (!unit) throw notFound(`Unknown customer unit '${unitId}'`);

  return sql`
    with recursive chain as (
      select id, parent_id, profile_id, 0 as depth
      from customer_units where id = ${unitId}
      union all
      select u.id, u.parent_id, u.profile_id, chain.depth + 1
      from customer_units u join chain on u.id = chain.parent_id
    ),
    ranked as (
      select id as unit_id, depth * 2 as rank from chain
      union all
      select profile_id, depth * 2 + 1 from chain where profile_id is not null
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
  ` as Promise<ResolvedFact[]>;
}
