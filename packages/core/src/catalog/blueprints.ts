/**
 * A product's blueprint: the kinds of unit its customers' setups divide into,
 * where each kind sits, which template it follows, and the facts it records.
 * A product with no kinds has no blueprint, and its units are free form.
 */
import type {
  ProductBlueprint,
  UnitKindFactRow,
  UnitKindRow,
} from "@tachy/contract";
import { sql, type Db } from "../infra/db";
import { badInput, conflict, notFound } from "../infra/errors";
import { wouldCycle } from "../infra/hierarchy";

/** Unit kinds and fact kinds are keys that flows and argument bindings name. */
const BLUEPRINT_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export interface UnitKindFactInput {
  kind: string;
  description?: string | null;
  choices?: string[];
  position?: number;
}

export interface UnitKindInput {
  productId: string;
  slug: string;
  name: string;
  description?: string | null;
  parentKind?: string | null;
  templateKind?: string | null;
  position?: number;
  /** Added or updated by fact kind; facts the kind already has stay. */
  facts?: UnitKindFactInput[];
}

/** A key that is present replaces the stored value; null clears it. */
export interface UnitKindPatch {
  slug?: string;
  name?: string;
  description?: string | null;
  parentKind?: string | null;
  templateKind?: string | null;
  position?: number;
}

export interface UnitKindFactPatch {
  kind?: string;
  description?: string | null;
  choices?: string[];
  position?: number;
}

interface KindRecord {
  id: string;
  slug: string;
  parent_kind_id: string | null;
  template_kind_id: string | null;
}

interface FactRecord {
  unit_kind_id: string;
  kind: string;
  choices: string[];
}

interface Blueprint {
  productSlug: string;
  kinds: KindRecord[];
  facts: FactRecord[];
}

function assertBlueprintSlug(slug: string, noun: string): void {
  if (!BLUEPRINT_SLUG_RE.test(slug))
    throw badInput(
      `invalid ${noun} '${slug}': lowercase letters, digits, dash and underscore only`,
    );
}

/** Trimmed, without blanks or repeats, in the order given. */
function cleanChoices(choices: string[] | undefined): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const choice of choices ?? []) {
    const trimmed = choice.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    kept.push(trimmed);
  }
  return kept;
}

async function productSlugOf(db: Db, productId: string): Promise<string> {
  const [row] = await db<{ slug: string }[]>`
    select slug from products where id = ${productId}
  `;
  if (!row) throw notFound(`product '${productId}' not found`);
  return row.slug;
}

export async function getProductBlueprint(
  productId: string,
): Promise<ProductBlueprint> {
  const productSlug = await productSlugOf(sql, productId);
  const kinds = await sql<(Omit<UnitKindRow, "facts"> & { id: string })[]>`
    select k.id, k.slug, k.name, k.description, k.position,
           parent.slug as parent_kind, template.slug as template_kind
    from unit_kinds k
    left join unit_kinds parent on parent.id = k.parent_kind_id
    left join unit_kinds template on template.id = k.template_kind_id
    where k.product_id = ${productId}
    order by k.position, k.slug
  `;
  const facts = await sql<(UnitKindFactRow & { unit_kind_id: string })[]>`
    select f.unit_kind_id, f.kind, f.description, f.choices, f.position
    from unit_kind_facts f join unit_kinds k on k.id = f.unit_kind_id
    where k.product_id = ${productId}
    order by f.position, f.kind
  `;
  return {
    product_slug: productSlug,
    kinds: kinds.map(({ id, ...kind }) => ({
      ...kind,
      facts: facts
        .filter((fact) => fact.unit_kind_id === id)
        .map(({ unit_kind_id: _kindId, ...fact }) => fact),
    })),
  };
}

async function getKind(
  db: Db,
  productId: string,
  slug: string,
): Promise<KindRecord> {
  const [row] = await db<KindRecord[]>`
    select id, slug, parent_kind_id, template_kind_id
    from unit_kinds where product_id = ${productId} and slug = ${slug}
  `;
  if (!row)
    throw notFound(
      `unit kind '${slug}' not found in this product's blueprint. call get_product_blueprint`,
    );
  return row;
}

async function kindIdOrNull(
  db: Db,
  productId: string,
  slug: string | null | undefined,
): Promise<string | null> {
  return slug ? (await getKind(db, productId, slug)).id : null;
}

/** Walking up from the proposed edge must not arrive back at the kind itself. */
async function assertNoKindCycle(
  kindId: string,
  edges: { parentKindId?: string | null; templateKindId?: string | null },
): Promise<void> {
  if (
    await wouldCycle(
      "unit_kinds",
      kindId,
      edges.parentKindId ?? null,
      "parent_kind_id",
    )
  )
    throw badInput("that parent kind already sits inside this kind");
  if (
    await wouldCycle(
      "unit_kinds",
      kindId,
      edges.templateKindId ?? null,
      "template_kind_id",
    )
  )
    throw badInput("that template kind already follows this kind");
}

async function upsertKindFact(
  db: Db,
  unitKindId: string,
  fact: UnitKindFactInput,
): Promise<void> {
  assertBlueprintSlug(fact.kind, "fact kind");
  await db`
    insert into unit_kind_facts (unit_kind_id, kind, description, choices, position)
    values (${unitKindId}, ${fact.kind}, ${fact.description ?? null},
            ${cleanChoices(fact.choices)}, ${fact.position ?? 0})
    on conflict (unit_kind_id, kind) do update set
      description = coalesce(excluded.description, unit_kind_facts.description),
      choices     = excluded.choices,
      position    = excluded.position
  `;
}

/**
 * Adds a kind to the product's blueprint, or updates the kind with that slug:
 * on an existing kind, keys the input leaves out keep their stored value.
 */
export async function addUnitKind(input: UnitKindInput) {
  assertBlueprintSlug(input.slug, "unit kind");
  const [existing] = await sql<{ id: string }[]>`
    select id from unit_kinds
    where product_id = ${input.productId} and slug = ${input.slug}
  `;
  if (existing) {
    const patch: UnitKindPatch = { name: input.name };
    if (input.description !== undefined) patch.description = input.description;
    if (input.parentKind !== undefined) patch.parentKind = input.parentKind;
    if (input.templateKind !== undefined)
      patch.templateKind = input.templateKind;
    if (input.position !== undefined) patch.position = input.position;
    await updateUnitKind(input.productId, input.slug, patch);
    for (const fact of input.facts ?? [])
      await upsertKindFact(sql, existing.id, fact);
    return { slug: input.slug, name: input.name, added: false };
  }
  return sql.begin(async (tx) => {
    const parentKindId = await kindIdOrNull(
      tx,
      input.productId,
      input.parentKind,
    );
    const templateKindId = await kindIdOrNull(
      tx,
      input.productId,
      input.templateKind,
    );
    const [row] = await tx<{ id: string }[]>`
      insert into unit_kinds
        (product_id, slug, name, description, parent_kind_id, template_kind_id, position)
      values
        (${input.productId}, ${input.slug}, ${input.name}, ${input.description ?? null},
         ${parentKindId}, ${templateKindId}, ${input.position ?? 0})
      returning id
    `;
    for (const fact of input.facts ?? [])
      await upsertKindFact(tx, row.id, fact);
    return { slug: input.slug, name: input.name, added: true };
  });
}

/** A renamed kind takes its units with it: their `kind` is rewritten. */
export async function updateUnitKind(
  productId: string,
  slug: string,
  patch: UnitKindPatch,
) {
  const current = await getKind(sql, productId, slug);
  const parentKindId =
    "parentKind" in patch
      ? await kindIdOrNull(sql, productId, patch.parentKind)
      : current.parent_kind_id;
  const templateKindId =
    "templateKind" in patch
      ? await kindIdOrNull(sql, productId, patch.templateKind)
      : current.template_kind_id;
  if (parentKindId === current.id || templateKindId === current.id)
    throw badInput(`'${slug}' cannot sit inside or follow itself`);
  await assertNoKindCycle(current.id, { parentKindId, templateKindId });

  const renamedTo = patch.slug && patch.slug !== slug ? patch.slug : null;
  if (renamedTo) {
    assertBlueprintSlug(renamedTo, "unit kind");
    const [taken] = await sql`
      select 1 from unit_kinds where product_id = ${productId} and slug = ${renamedTo}
    `;
    if (taken)
      throw conflict(
        `unit kind '${renamedTo}' already exists in this blueprint`,
      );
  }
  return sql.begin(async (tx) => {
    const [row] = await tx`
      update unit_kinds set
        slug             = ${renamedTo ?? slug},
        name             = coalesce(${patch.name ?? null}, name),
        description      = ${"description" in patch ? (patch.description ?? null) : sql`description`},
        parent_kind_id   = ${parentKindId},
        template_kind_id = ${templateKindId},
        position         = coalesce(${patch.position ?? null}, position)
      where id = ${current.id}
      returning slug, name
    `;
    if (renamedTo)
      await tx`
        update customer_units set kind = ${renamedTo}
        where product_id = ${productId} and kind = ${slug}
      `;
    return row;
  });
}

/** Refused while units have the kind or another kind sits inside or follows it. */
export async function deleteUnitKind(productId: string, slug: string) {
  const current = await getKind(sql, productId, slug);
  const [units] = await sql<{ n: number }[]>`
    select count(*)::int as n from customer_units
    where product_id = ${productId} and kind = ${slug}
  `;
  if (units.n > 0)
    throw conflict(
      `${units.n} unit(s) are '${slug}': give them another kind first`,
      { units: units.n },
    );
  const dependents = await sql<{ slug: string }[]>`
    select slug from unit_kinds
    where parent_kind_id = ${current.id} or template_kind_id = ${current.id}
    order by slug
  `;
  if (dependents.length)
    throw conflict(
      `${dependents.map((d) => `'${d.slug}'`).join(", ")} sit inside or follow '${slug}': change them first`,
    );
  await sql`delete from unit_kinds where id = ${current.id}`;
  return { deleted: true, slug };
}

export async function setUnitKindFact(
  productId: string,
  kindSlug: string,
  fact: UnitKindFactInput,
) {
  const kind = await getKind(sql, productId, kindSlug);
  await upsertKindFact(sql, kind.id, fact);
  return { unit_kind: kindSlug, kind: fact.kind };
}

/**
 * How many facts of `factKind` units record under this kind's definition: on
 * units of the kind, and on the templates they follow, which hold their facts.
 */
async function factUseCount(
  productId: string,
  kind: KindRecord,
  factKind: string,
): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n
    from customer_facts f join customer_units u on u.id = f.unit_id
    where u.product_id = ${productId} and f.kind = ${factKind}
      and (u.kind = ${kind.slug}
           or u.kind = (select slug from unit_kinds where id = ${kind.template_kind_id}))
  `;
  return row.n;
}

/** A fact kind is renamed only while no unit records it. */
export async function updateUnitKindFact(
  productId: string,
  kindSlug: string,
  factKind: string,
  patch: UnitKindFactPatch,
) {
  const kind = await getKind(sql, productId, kindSlug);
  const renamedTo = patch.kind && patch.kind !== factKind ? patch.kind : null;
  if (renamedTo) {
    assertBlueprintSlug(renamedTo, "fact kind");
    const used = await factUseCount(productId, kind, factKind);
    if (used > 0)
      throw conflict(
        `${used} fact(s) are recorded as '${factKind}': a fact kind in use keeps its name`,
        { facts: used },
      );
  }
  const [row] = await sql`
    update unit_kind_facts set
      kind        = ${renamedTo ?? factKind},
      description = ${"description" in patch ? (patch.description ?? null) : sql`description`},
      choices     = ${patch.choices ? cleanChoices(patch.choices) : sql`choices`},
      position    = coalesce(${patch.position ?? null}, position)
    where unit_kind_id = ${kind.id} and kind = ${factKind}
    returning kind, description, choices, position
  `;
  if (!row)
    throw notFound(`'${kindSlug}' has no fact '${factKind}' in its blueprint`);
  return row;
}

export async function deleteUnitKindFact(
  productId: string,
  kindSlug: string,
  factKind: string,
) {
  const kind = await getKind(sql, productId, kindSlug);
  const used = await factUseCount(productId, kind, factKind);
  if (used > 0)
    throw conflict(
      `${used} fact(s) are recorded as '${factKind}': delete or change them first`,
      { facts: used },
    );
  const [row] = await sql`
    delete from unit_kind_facts
    where unit_kind_id = ${kind.id} and kind = ${factKind}
    returning kind
  `;
  if (!row)
    throw notFound(`'${kindSlug}' has no fact '${factKind}' in its blueprint`);
  return { deleted: true, kind: factKind };
}

async function blueprintOf(
  db: Db,
  productId: string,
): Promise<Blueprint | null> {
  const kinds = await db<KindRecord[]>`
    select id, slug, parent_kind_id, template_kind_id
    from unit_kinds where product_id = ${productId}
    order by position, slug
  `;
  if (!kinds.length) return null;
  const facts = await db<FactRecord[]>`
    select f.unit_kind_id, f.kind, f.choices
    from unit_kind_facts f join unit_kinds k on k.id = f.unit_kind_id
    where k.product_id = ${productId}
    order by f.position, f.kind
  `;
  return {
    productSlug: await productSlugOf(db, productId),
    kinds: [...kinds],
    facts: [...facts],
  };
}

const slugList = (slugs: string[]) =>
  slugs.length ? slugs.map((s) => `'${s}'`).join(", ") : "none yet";

function kindNamed(blueprint: Blueprint, slug: string): KindRecord {
  const kind = blueprint.kinds.find((k) => k.slug === slug);
  if (!kind)
    throw badInput(
      `'${slug}' is not a unit kind in ${blueprint.productSlug}'s blueprint (${slugList(
        blueprint.kinds.map((k) => k.slug),
      )}). pick one of those, or propose add_unit_kind first`,
    );
  return kind;
}

export interface BlueprintUnit {
  productId: string | null;
  kind: string;
  parentId: string | null;
  templateId: string | null;
}

interface PlacedUnit {
  slug: string;
  kind: string;
  product_id: string | null;
}

async function placedUnit(db: Db, unitId: string): Promise<PlacedUnit> {
  const [row] = await db<PlacedUnit[]>`
    select slug, kind, product_id from customer_units where id = ${unitId}
  `;
  if (!row) throw notFound(`unit '${unitId}' not found`);
  return row;
}

/** Throws unless `edge` names a unit of `expected` within the same product. */
async function assertEdgeFits(
  db: Db,
  blueprint: Blueprint,
  unit: BlueprintUnit & { productId: string },
  edge: { unitId: string; expectedKindId: string | null; relation: string },
): Promise<void> {
  const target = await placedUnit(db, edge.unitId);
  const expected = blueprint.kinds.find((k) => k.id === edge.expectedKindId);
  if (!expected)
    throw badInput(
      `a ${unit.kind} ${edge.relation} no unit in ${blueprint.productSlug}'s blueprint, so it cannot ${edge.relation} '${target.slug}'`,
    );
  if (target.product_id !== unit.productId)
    throw badInput(
      `'${target.slug}' belongs to another product's setup; a ${unit.kind} ${edge.relation} a ${expected.slug} of ${blueprint.productSlug}`,
    );
  if (target.kind !== expected.slug)
    throw badInput(
      `a ${unit.kind} ${edge.relation} a ${expected.slug}; '${target.slug}' is a ${target.kind}`,
    );
}

/**
 * Throws unless a unit fits its product's blueprint: a kind it lists, inside a
 * unit of the parent kind (or at the top), following a template of the
 * template kind. A general unit, or a product with no blueprint, takes anything.
 */
export async function assertUnitFitsBlueprint(
  db: Db,
  unit: BlueprintUnit,
): Promise<void> {
  if (!unit.productId) return;
  const blueprint = await blueprintOf(db, unit.productId);
  if (!blueprint) return;
  const kind = kindNamed(blueprint, unit.kind);
  const placed = { ...unit, productId: unit.productId };
  if (unit.parentId)
    await assertEdgeFits(db, blueprint, placed, {
      unitId: unit.parentId,
      expectedKindId: kind.parent_kind_id,
      relation: "sits inside",
    });
  if (unit.templateId)
    await assertEdgeFits(db, blueprint, placed, {
      unitId: unit.templateId,
      expectedKindId: kind.template_kind_id,
      relation: "follows",
    });
}

/**
 * The facts a unit of `kind` may record: its own, and, on a template, those of
 * the kinds that follow it, which inherit them from it.
 */
function factsAllowedOn(blueprint: Blueprint, kind: KindRecord): FactRecord[] {
  const followers = blueprint.kinds
    .filter((k) => k.template_kind_id === kind.id)
    .map((k) => k.id);
  return blueprint.facts.filter(
    (fact) =>
      fact.unit_kind_id === kind.id || followers.includes(fact.unit_kind_id),
  );
}

/**
 * The value to store for a fact on `unit`: the value as given, or, when the
 * blueprint lists choices, the spelling of the choice it matches. Throws when
 * the blueprint has no such fact for the unit's kind, or the value is not one
 * of the choices. A customer-wide fact, a general unit, or a product with no
 * blueprint takes anything.
 */
export async function resolveFactValue(
  db: Db,
  unit: { productId: string | null; kind: string } | null,
  fact: { kind: string; value: string },
): Promise<string> {
  if (!unit?.productId) return fact.value;
  const blueprint = await blueprintOf(db, unit.productId);
  if (!blueprint) return fact.value;
  const kind = kindNamed(blueprint, unit.kind);
  const allowed = factsAllowedOn(blueprint, kind);
  const definition = allowed.find((f) => f.kind === fact.kind);
  if (!definition)
    throw badInput(
      `'${fact.kind}' is not a fact of a ${kind.slug} in ${blueprint.productSlug}'s blueprint (${slugList(
        [...new Set(allowed.map((f) => f.kind))],
      )}). use one of those, or propose add_unit_kind with the fact`,
    );
  if (!definition.choices.length) return fact.value;
  const wanted = fact.value.trim().toLowerCase();
  const choice = definition.choices.find((c) => c.toLowerCase() === wanted);
  if (!choice)
    throw badInput(
      `'${fact.value}' is not a value of ${fact.kind}: one of ${slugList(definition.choices)}`,
    );
  return choice;
}
