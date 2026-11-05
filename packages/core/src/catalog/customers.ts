import type {
  CustomerComponentRow,
  CustomerFactRow,
  CustomerProfile,
  CustomerRow,
} from "@tachy/contract";

export type { CustomerProfile };
import { sql } from "../infra/db";
import { nearestSlugsHint } from "./nearest";
import { badInput, conflict, notFound } from "../infra/errors";
import { assertNoSecrets } from "../compliance/redaction";
import { resolveComponentStrict } from "./components";
import {
  blueprintConflicts,
  expectedFactKinds,
  resolveFactValue,
} from "./blueprints";
import {
  assertUnitInProduct,
  filedText,
  filedTotal,
  listCustomerUnits,
  listUnitDocs,
  listUnitEntries,
  resolveUnit,
  resolveUnitFacts,
  unitWithDescendants,
  type CustomerUnitRow,
} from "./units";
import { linkCustomerProduct, listCustomerProducts } from "./customer-products";
import {
  inNewBatch,
  recordDeleted,
  trackRecord,
  type WriteContext,
} from "./customer-history";
import type { ActorRef } from "../library/revisions";

export interface CustomerInput {
  name: string;
  slug: string;
  aliases?: string[];
  emailDomains?: string[];
  notes?: string;
  /** Products the customer uses, linked as it is created. */
  productIds?: string[];
}

/** Domains are compared lowercased and bare, so '@Foo.COM ' and 'foo.com' agree. */
const normalizeDomains = (domains: string[] | undefined) =>
  (domains ?? [])
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

export interface CustomerListOptions {
  /** Only customers that use this product. */
  productId?: string;
  /** Only customers that run this component. */
  componentId?: string;
}

export async function listCustomers(opts: CustomerListOptions = {}) {
  return sql<CustomerRow[]>`
    select c.id, c.name, c.slug, c.aliases, c.email_domains, c.notes,
           coalesce((
             select array_agg(p.slug order by p.slug)
             from customer_products cp join products p on p.id = cp.product_id
             where cp.customer_id = c.id
           ), '{}') as products
    from customers c
    where true
      ${
        opts.productId
          ? sql`and exists (select 1 from customer_products cp
                            where cp.customer_id = c.id and cp.product_id = ${opts.productId})`
          : sql``
      }
      ${
        opts.componentId
          ? sql`and exists (select 1 from customer_components cc
                            where cc.customer_id = c.id and cc.component_id = ${opts.componentId})`
          : sql``
      }
    order by c.name
  `;
}

export async function addCustomer(input: CustomerInput, actor?: ActorRef) {
  assertNoSecrets({ notes: input.notes });
  return inNewBatch(actor, async (ctx) => {
    const [row] = await trackRecord(
      ctx,
      "customer",
      { slug: input.slug },
      () =>
        ctx.db`
        insert into customers (name, slug, aliases, email_domains, notes)
        values (${input.name}, ${input.slug}, ${input.aliases ?? []},
                ${normalizeDomains(input.emailDomains)}, ${input.notes ?? null})
        on conflict (slug) do update set
          name = excluded.name,
          aliases = excluded.aliases,
          email_domains = excluded.email_domains,
          notes = coalesce(excluded.notes, customers.notes)
        returning id, name, slug, aliases, email_domains
      `,
    );
    for (const productId of input.productIds ?? [])
      await linkCustomerProduct(row.id, productId, { within: ctx });
    return row;
  });
}

export async function updateCustomer(
  slug: string,
  patch: {
    name?: string;
    aliases?: string[];
    emailDomains?: string[];
    notes?: string | null;
  },
  actor?: ActorRef,
) {
  assertNoSecrets({ notes: patch.notes });
  const [current] =
    await sql`select id, name, aliases, email_domains, notes from customers where slug = ${slug}`;
  if (!current) throw notFound(`customer '${slug}' not found`);
  return inNewBatch(actor, async (ctx) => {
    const [row] = await trackRecord(
      ctx,
      "customer",
      { id: current.id },
      () =>
        ctx.db`
        update customers set
          name          = ${patch.name ?? current.name},
          aliases       = ${patch.aliases ?? current.aliases},
          email_domains = ${patch.emailDomains ? normalizeDomains(patch.emailDomains) : current.email_domains},
          notes         = ${"notes" in patch ? patch.notes : current.notes}
        where id = ${current.id}
        returning id, name, slug, aliases, email_domains, notes
      `,
    );
    return row;
  });
}

/** What names a customer, which a delete would un-file or orphan. */
type FiledUnderCustomer = {
  work_items: number;
  entries: number;
  docs: number;
  repos: number;
  source_projects: number;
};

/**
 * Refused while tickets, entries, docs, repos or source projects name the
 * customer: deleting it would un-file them silently. Its units, facts and links
 * go with it, recorded in the same batch so a restore brings them back.
 */
export async function deleteCustomer(slug: string, actor?: ActorRef) {
  const [current] = await sql`select id from customers where slug = ${slug}`;
  if (!current) throw notFound(`customer '${slug}' not found`);
  const [filed] = await sql<FiledUnderCustomer[]>`
    select
      (select count(*)::int from work_items where customer_id = ${current.id}) as work_items,
      (select count(*)::int from knowledge_entries where customer_id = ${current.id}) as entries,
      (select count(*)::int from reference_docs where customer_id = ${current.id}) as docs,
      (select count(*)::int from repos where customer_id = ${current.id}) as repos,
      (select count(*)::int from source_projects where customer_id = ${current.id}) as source_projects
  `;
  if (filedTotal(filed) > 0)
    throw conflict(
      `customer '${slug}' still has ${filedText(filed)} filed under it: reassign them first (set_work_item_customer for tickets)`,
      { filed },
    );
  await inNewBatch(actor, async (ctx) => {
    await recordCustomerContents(ctx, current.id);
    await trackRecord(
      ctx,
      "customer",
      { id: current.id },
      () => ctx.db`delete from customers where id = ${current.id}`,
    );
  });
  return { deleted: true, slug };
}

/**
 * Records as deleted everything the customer's delete cascades to, in an order
 * whose reverse a restore can insert: facts, links, then units deepest first.
 */
async function recordCustomerContents(
  ctx: WriteContext,
  customerId: string,
): Promise<void> {
  const { db } = ctx;
  await recordDeleted(
    ctx,
    "fact",
    await db`select * from customer_facts where customer_id = ${customerId}`,
  );
  await recordDeleted(
    ctx,
    "component",
    await db`select * from customer_components where customer_id = ${customerId}`,
  );
  await recordDeleted(
    ctx,
    "product",
    await db`select * from customer_products where customer_id = ${customerId}`,
  );
  await recordDeleted(
    ctx,
    "unit",
    await db`
      with recursive tree as (
        select id, 0 as depth from customer_units
        where customer_id = ${customerId} and parent_id is null
        union all
        select u.id, tree.depth + 1
        from customer_units u join tree on u.parent_id = tree.id
      )
      select u.* from customer_units u left join tree on tree.id = u.id
      where u.customer_id = ${customerId}
      order by coalesce(tree.depth, -1) desc
    `,
  );
}

export interface CustomerMatch {
  customerId: string | null;
  /** Why nothing was matched, when the answer is not simply "no such domain". */
  reason?: string;
}

/**
 * Sender domain → customer, including partners who front for one (a distributor
 * raising tickets on their behalf lists its domain on the customer's row). A
 * domain registered to more than one customer resolves to neither: picking one
 * would file the ticket, the entry learned from it and every later search hit
 * under a customer nobody chose.
 */
export async function resolveCustomerByEmail(
  email: string | undefined,
): Promise<CustomerMatch> {
  if (!email) return { customerId: null };
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return { customerId: null };
  const rows = await sql`
    select id, slug from customers
    where ${domain} = any(email_domains) or lower(slug) = ${domain}
  `;
  if (rows.length === 1) return { customerId: rows[0].id as string };
  if (rows.length > 1)
    return {
      customerId: null,
      reason: `'${domain}' is registered to ${rows.length} customers (${rows
        .map((r) => `'${r.slug}'`)
        .join(
          ", ",
        )}): it fronts for more than one, so the sender's domain cannot decide this`,
    };
  return { customerId: null };
}

export interface ResolvedCustomer {
  id: string;
  slug: string;
  name: string;
}

/**
 * Slug, then alias, then a trigram-ranked hint on a miss: the ladder
 * `resolveComponentStrict` offers, so the other names an account trades under
 * resolve too. Slugs are unique but aliases are not, so an alias claimed by two
 * customers is reported as ambiguous.
 */
export async function resolveCustomer(
  slugOrAlias: string,
): Promise<ResolvedCustomer> {
  const rows = await sql`
    select id, slug, name from customers
    where slug = ${slugOrAlias}
       or exists (select 1 from unnest(aliases) a where lower(a) = lower(${slugOrAlias}))
    order by (slug = ${slugOrAlias}) desc
    limit 2
  `;
  if (rows.length === 1 || (rows.length > 1 && rows[0].slug === slugOrAlias))
    return rows[0] as ResolvedCustomer;
  if (rows.length > 1)
    throw badInput(
      `ambiguous customer '${slugOrAlias}': alias of ${rows
        .map((r) => `'${r.slug}'`)
        .join(" and ")}. use the slug itself`,
    );

  const hint = await nearestSlugsHint("customers", slugOrAlias);
  throw badInput(
    `unknown customer '${slugOrAlias}'.${hint} call list_customers, or add_customer first`,
  );
}

export async function getCustomerIdBySlug(slug: string): Promise<string> {
  return (await resolveCustomer(slug)).id;
}

/**
 * A filter on one customer's items, and with a unit, on that unit and the
 * units inside it: asking for a site means its lines too.
 */
export async function resolveCustomerFilter(
  customerSlug: string | null | undefined,
  unit?: string | null,
): Promise<{ customerId?: string; unitIds?: string[] }> {
  if (!customerSlug) {
    if (unit) throw badInput("a unit needs its customer: pass customer too");
    return {};
  }
  const customerId = await getCustomerIdBySlug(customerSlug);
  if (!unit) return { customerId };
  const { id } = await resolveUnit(customerId, unit);
  return { customerId, unitIds: await unitWithDescendants(id) };
}

/**
 * Attribute a ticket to a customer, and optionally to one part of their setup.
 * Clearing the customer clears the unit with it: a unit belongs to a customer,
 * so a ticket carrying a unit but no customer is a state that cannot be read
 * back sensibly.
 */
export async function setWorkItemCustomer(
  workItemId: string,
  customerId: string | null,
  unit?: string | null,
) {
  // An absent `unit` leaves it alone and an explicit null clears it: the common
  // call sets the customer alone and keeps the line the ticket was narrowed to.
  // It survives only while the customer is unchanged.
  const [current] = await sql`
    select customer_id, product_id from work_items where id = ${workItemId}
  `;
  const keepUnit =
    unit === undefined &&
    customerId !== null &&
    current?.customer_id === customerId;

  let unitId: string | null = null;
  if (customerId && unit) {
    const resolved = await resolveUnit(customerId, unit);
    assertUnitInProduct(resolved, current?.product_id ?? null);
    unitId = resolved.id;
  }
  await sql`
    update work_items
    set customer_id = ${customerId},
        customer_unit_id = ${keepUnit ? sql`customer_unit_id` : sql`${unitId}`}
    where id = ${workItemId}
  `;
}

export async function setObservedVersion(
  workItemId: string,
  version: string | null,
) {
  await sql`update work_items set observed_version = ${version} where id = ${workItemId}`;
}

export async function getCustomerName(
  customerId: string | null,
): Promise<string | null> {
  if (!customerId) return null;
  const [row] = await sql`select name from customers where id = ${customerId}`;
  return row?.name ?? null;
}

export async function getCustomerSlug(
  customerId: string | null,
): Promise<string | null> {
  if (!customerId) return null;
  const [row] = await sql`select slug from customers where id = ${customerId}`;
  return row?.slug ?? null;
}

export interface CustomerFactInput {
  customerSlug: string;
  kind: string;
  label?: string;
  value: string;
  notes?: string | null;
  source?: string | null;
  componentSlug?: string | null;
  /** Resolves `componentSlug` on a customer-wide fact; a unit's product wins over it. */
  productId?: string | null;
  /**
   * Which part of their setup this is true of, by unit slug or alias. Omit for
   * a fact true of the whole customer.
   */
  unit?: string | null;
  /** The library doc that details the fact. Absent keeps the stored link; null clears it. */
  docId?: string | null;
}

/** Throws unless the doc exists and is a current version. */
async function assertLinkableDoc(docId: string): Promise<void> {
  const [doc] = await sql<{ status: string; superseded_by: string | null }[]>`
    select status, superseded_by from reference_docs where id = ${docId}
  `;
  if (!doc) throw badInput(`reference doc '${docId}' not found`);
  if (doc.status === "archived")
    throw badInput(
      doc.superseded_by
        ? `reference doc '${docId}' was superseded by '${doc.superseded_by}': link that one`
        : `reference doc '${docId}' is archived`,
    );
}

/**
 * Set one specific about a customer's install. Keyed on (customer, unit, kind,
 * label) with nulls not distinct, so re-stating a version replaces it, while the
 * same kind stated for one line coexists with the customer-wide one. On a unit
 * of a product with a blueprint, `resolveFactValue` decides what may be stored.
 */
export async function setCustomerFact(
  input: CustomerFactInput,
  actor?: ActorRef,
) {
  const customerId = await getCustomerIdBySlug(input.customerSlug);
  if (!input.kind.trim()) throw badInput("kind is required");
  if (!input.value.trim()) throw badInput("value is required");
  assertNoSecrets({
    value: input.value,
    label: input.label,
    notes: input.notes,
    source: input.source,
  });
  const unit = input.unit ? await resolveUnit(customerId, input.unit) : null;
  if (unit && input.productId) assertUnitInProduct(unit, input.productId);
  const productId = unit?.product_id ?? input.productId ?? null;
  let componentId: string | null = null;
  if (input.componentSlug) {
    if (!productId)
      throw badInput(
        "a component needs its product: pass product_slug with component",
      );
    componentId = (await resolveComponentStrict(productId, input.componentSlug))
      .id;
  }
  if (input.docId) await assertLinkableDoc(input.docId);
  const kind = input.kind.trim();
  const label = input.label?.trim() ?? "";
  const value = await resolveFactValue(
    sql,
    unit ? { productId: unit.product_id, kind: unit.kind } : null,
    { kind, value: input.value.trim() },
  );
  const [row] = await inNewBatch(actor, (ctx) =>
    trackRecord(
      ctx,
      "fact",
      { customer_id: customerId, unit_id: unit?.id ?? null, kind, label },
      () => ctx.db<
        {
          id: string;
          kind: string;
          label: string;
          value: string;
          unit_id: string | null;
        }[]
      >`
        insert into customer_facts
          (customer_id, unit_id, kind, label, value, notes, source, component_id, doc_id)
        values (${customerId}, ${unit?.id ?? null}, ${kind}, ${label}, ${value},
                ${input.notes ?? null}, ${input.source ?? null}, ${componentId},
                ${input.docId ?? null})
        on conflict (customer_id, unit_id, kind, label) do update set
          value        = excluded.value,
          notes        = coalesce(excluded.notes, customer_facts.notes),
          source       = coalesce(excluded.source, customer_facts.source),
          component_id = excluded.component_id,
          doc_id       = ${"docId" in input ? ctx.db`excluded.doc_id` : ctx.db`customer_facts.doc_id`}
        returning id, kind, label, value, unit_id
      `,
    ),
  );
  return { ...row, unit: unit?.slug ?? null };
}

/** Only a fact of `customerId`: a fact id from another customer is not found. */
export async function deleteCustomerFact(
  customerId: string,
  id: string,
  actor?: ActorRef,
) {
  await inNewBatch(actor, (ctx) =>
    trackRecord(ctx, "fact", { id, customer_id: customerId }, async () => {
      const [row] = await ctx.db`
        delete from customer_facts
        where id = ${id} and customer_id = ${customerId}
        returning id
      `;
      if (!row) throw notFound(`customer fact '${id}' not found`);
    }),
  );
  return { deleted: true, id };
}

/** One fact with the unit it is on, for the rights a write to it needs. */
export async function getCustomerFact(customerId: string, id: string) {
  const [row] = await sql<
    { id: string; unit_id: string | null; product_id: string | null }[]
  >`
    select f.id, f.unit_id, u.product_id
    from customer_facts f left join customer_units u on u.id = f.unit_id
    where f.id = ${id} and f.customer_id = ${customerId}
  `;
  if (!row) throw notFound(`customer fact '${id}' not found`);
  return row;
}

export async function listCustomerFacts(customerId: string) {
  return sql<CustomerFactRow[]>`
    select f.id, f.unit_id, u.slug as unit_slug, f.kind, f.label, f.value,
           f.notes, f.source, f.component_id, c.slug as component_slug,
           f.doc_id, d.title as doc_title, f.updated_at
    from customer_facts f
    left join customer_units u on u.id = f.unit_id
    left join components c on c.id = f.component_id
    left join reference_docs d on d.id = f.doc_id
    where f.customer_id = ${customerId}
    order by u.slug nulls first, f.kind, f.label
  `;
}

/**
 * The `kind` values already in use, with counts. Same idea as listEnvironments:
 * the vocabulary is whatever this deployment needs, so it is reported rather
 * than enumerated, and callers reuse a value instead of coining a
 * near-duplicate.
 */
export async function listCustomerFactKinds(): Promise<
  { kind: string; count: number }[]
> {
  return sql<{ kind: string; count: number }[]>`
    select kind, count(*)::int as count from customer_facts
    group by kind order by count desc, kind
  `;
}

/** Record that a customer runs a component, and so uses its product. Idempotent. */
export async function linkCustomerComponent(
  customerSlug: string,
  productId: string,
  componentSlug: string,
  opts: { notes?: string | null; actor?: ActorRef } = {},
) {
  const customerId = await getCustomerIdBySlug(customerSlug);
  const component = await resolveComponentStrict(productId, componentSlug);
  await inNewBatch(opts.actor, async (ctx) => {
    await trackRecord(
      ctx,
      "component",
      { customer_id: customerId, component_id: component.id },
      () => ctx.db`
        insert into customer_components (customer_id, component_id, notes)
        values (${customerId}, ${component.id}, ${opts.notes ?? null})
        on conflict (customer_id, component_id) do update set
          notes = coalesce(excluded.notes, customer_components.notes)
      `,
    );
    await linkCustomerProduct(customerId, productId, { within: ctx });
  });
  return { customer: customerSlug, component: component.slug };
}

export async function unlinkCustomerComponent(
  customerSlug: string,
  productId: string,
  componentSlug: string,
  actor?: ActorRef,
) {
  const customerId = await getCustomerIdBySlug(customerSlug);
  const component = await resolveComponentStrict(productId, componentSlug);
  await inNewBatch(actor, (ctx) =>
    trackRecord(
      ctx,
      "component",
      { customer_id: customerId, component_id: component.id },
      () => ctx.db`
        delete from customer_components
        where customer_id = ${customerId} and component_id = ${component.id}
      `,
    ),
  );
  return { unlinked: true, customer: customerSlug, component: component.slug };
}

export async function listCustomerComponents(customerId: string) {
  return sql<CustomerComponentRow[]>`
    select c.id, c.slug, c.name, c.product_id, p.slug as product_slug,
           cc.notes
    from customer_components cc
    join components c on c.id = cc.component_id
    join products p on p.id = c.product_id
    where cc.customer_id = ${customerId}
    order by p.slug, c.slug
  `;
}

const docLink = (fact: { doc_id: string | null; doc_title: string | null }) =>
  fact.doc_id ? { id: fact.doc_id, title: fact.doc_title ?? "" } : null;

/**
 * Everything configured about one customer, in one read: their version and
 * addons decide whether a general answer applies. Without `unit`, the facts are
 * the customer-wide ones; with it, the resolved ladder for that part of their
 * setup, what its blueprint still misses, and the docs and entries around it.
 */
export async function getCustomerProfile(
  customerId: string,
  unit?: string | null,
): Promise<CustomerProfile | null> {
  const [customer] = await sql<
    Pick<CustomerProfile, "id" | "slug" | "name" | "notes">[]
  >`
    select id, slug, name, notes from customers where id = ${customerId}
  `;
  if (!customer) return null;
  const resolvedUnit = unit ? await resolveUnit(customerId, unit) : null;
  const [products, components, repos, projects, units, conflicts] =
    await Promise.all([
      listCustomerProducts(customerId),
      listCustomerComponents(customerId),
      sql<CustomerProfile["repos"]>`
        select r.slug, c.slug as component, coalesce(dl.index_status, 'idle') as index_status
        from repos r
        left join repo_lines dl on dl.repo_id = r.id and dl.ref = r.default_branch
        left join components c on c.id = r.component_id
        where r.customer_id = ${customerId} order by r.slug
      `,
      sql<CustomerProfile["projects"]>`
        select sc.slug as source_slug, sp.external_key
        from source_projects sp
        join source_connections sc on sc.id = sp.source_connection_id
        where sp.customer_id = ${customerId} order by sp.external_key
      `,
      listCustomerUnits(customerId),
      blueprintConflicts(customerId),
    ]);
  const slugOf = (id: string | null) =>
    units.find((u) => u.id === id)?.slug ?? null;
  return {
    ...customer,
    products: products.map((p) => p.slug),
    ...(resolvedUnit
      ? await unitReading(resolvedUnit)
      : await customerReading(customerId)),
    units: units.map((u) => ({
      slug: u.slug,
      name: u.name,
      kind: u.kind,
      product: u.product_slug,
      parent: slugOf(u.parent_id),
      template: slugOf(u.template_id),
    })),
    components: components.map((c) => ({
      slug: c.slug,
      product_slug: c.product_slug,
    })),
    repos: [...repos],
    projects: [...projects],
    conflicts,
  };
}

/** A customer read: the customer-wide facts, and how much is filed under them. */
async function customerReading(
  customerId: string,
): Promise<Pick<CustomerProfile, "facts" | "library">> {
  const facts = (await listCustomerFacts(customerId)).filter(
    (fact) => !fact.unit_id,
  );
  const [library] = await sql<{ entries: number; docs: number }[]>`
    select
      (select count(*)::int from knowledge_entries
        where customer_id = ${customerId} and status not in ('rejected', 'archived')) as entries,
      (select count(*)::int from reference_docs
        where customer_id = ${customerId} and status = 'approved') as docs
  `;
  return {
    facts: facts.map((fact) => ({
      kind: fact.kind,
      label: fact.label,
      value: fact.value,
      component: fact.component_slug,
      doc: docLink(fact),
    })),
    library,
  };
}

/**
 * A unit read: the facts that apply to it, each saying which level it came
 * from and whether it was inherited rather than stated here; what its
 * blueprint still misses; and the docs and entries filed around it.
 */
async function unitReading(
  unit: CustomerUnitRow,
): Promise<
  Pick<CustomerProfile, "unit" | "facts" | "missing" | "documents" | "entries">
> {
  const [facts, expected, documents, entries] = await Promise.all([
    resolveUnitFacts(unit.id),
    expectedFactKinds({ productId: unit.product_id, kind: unit.kind }),
    listUnitDocs(unit.id),
    listUnitEntries(unit.id),
  ]);
  const recorded = new Set(facts.map((fact) => fact.kind));
  return {
    unit: {
      slug: unit.slug,
      name: unit.name,
      kind: unit.kind,
      product: unit.product_slug,
    },
    facts: facts.map((fact) => ({
      kind: fact.kind,
      label: fact.label,
      value: fact.value,
      component: null,
      origin: fact.origin_slug,
      origin_kind: fact.origin_kind,
      inherited: fact.inherited,
      doc: docLink(fact),
    })),
    missing: expected.filter((kind) => !recorded.has(kind)),
    documents: [...documents],
    entries: [...entries],
  };
}
