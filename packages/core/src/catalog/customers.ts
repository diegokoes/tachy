import { sql } from "../infra/db";
import { badInput, conflict, notFound } from "../infra/errors";
import { resolveComponentStrict } from "./components";

export interface CustomerInput {
  name: string;
  slug: string;
  aliases?: string[];
  emailDomains?: string[];
  notes?: string;
}

/** Domains are compared lowercased and bare, so '@Foo.COM ' and 'foo.com' agree. */
const normalizeDomains = (domains: string[] | undefined) =>
  (domains ?? [])
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

export async function listCustomers() {
  return sql`select id, name, slug, aliases, email_domains, notes from customers order by name`;
}

export async function addCustomer(i: CustomerInput) {
  const [row] = await sql`
    insert into customers (name, slug, aliases, email_domains, notes)
    values (${i.name}, ${i.slug}, ${i.aliases ?? []},
            ${normalizeDomains(i.emailDomains)}, ${i.notes ?? null})
    on conflict (slug) do update set
      name = excluded.name,
      aliases = excluded.aliases,
      email_domains = excluded.email_domains,
      notes = coalesce(excluded.notes, customers.notes)
    returning id, name, slug, aliases, email_domains
  `;
  return row;
}

export async function updateCustomer(
  slug: string,
  patch: {
    name?: string;
    aliases?: string[];
    emailDomains?: string[];
    notes?: string | null;
  },
) {
  const [current] =
    await sql`select id, name, aliases, email_domains, notes from customers where slug = ${slug}`;
  if (!current) throw notFound(`Customer '${slug}' not found`);
  const [row] = await sql`
    update customers set
      name          = ${patch.name ?? current.name},
      aliases       = ${patch.aliases ?? current.aliases},
      email_domains = ${patch.emailDomains ? normalizeDomains(patch.emailDomains) : current.email_domains},
      notes         = ${"notes" in patch ? patch.notes : current.notes}
    where id = ${current.id}
    returning id, name, slug, aliases, email_domains, notes
  `;
  return row;
}

export async function deleteCustomer(slug: string) {
  const [current] = await sql`select id from customers where slug = ${slug}`;
  if (!current) throw notFound(`Customer '${slug}' not found`);
  const [ref] =
    await sql`select count(*)::int as n from work_items where customer_id = ${current.id}`;
  if (ref.n > 0)
    throw conflict(
      `customer '${slug}' is referenced by ${ref.n} work item(s) - reassign them first (set_work_item_customer)`,
    );
  await sql`delete from customers where id = ${current.id}`;
  return { deleted: true, slug };
}

export interface CustomerMatch {
  customerId: string | null;
  /** Why nothing was matched, when the answer is not simply "no such domain". */
  reason?: string;
}

/**
 * Sender domain → customer, including partners who front for one (a distributor
 * raising tickets on their behalf lists its domain on the customer's row).
 *
 * A domain registered to more than one customer resolves to NEITHER. Picking one
 * would file the ticket, the entry learned from it and every future search hit
 * under a customer nobody chose — an unresolved item that says why is recoverable,
 * a confidently wrong one is not.
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
        )}) — it fronts for more than one, so the sender's domain cannot decide this`,
    };
  return { customerId: null };
}

export async function getCustomerIdBySlug(slug: string): Promise<string> {
  const [row] = await sql`select id from customers where slug = ${slug}`;
  if (!row)
    throw badInput(
      `Unknown customer '${slug}'. Call list_customers, or add_customer first.`,
    );
  return row.id as string;
}

export async function setWorkItemCustomer(
  workItemId: string,
  customerId: string | null,
) {
  await sql`update work_items set customer_id = ${customerId} where id = ${workItemId}`;
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
  productId?: string | null;
}

/**
 * Set one specific about a customer's install. Keyed on (customer, kind, label),
 * so re-stating a version replaces it instead of leaving two answers to the same
 * question in the profile.
 */
export async function setCustomerFact(i: CustomerFactInput) {
  const customerId = await getCustomerIdBySlug(i.customerSlug);
  if (!i.kind.trim()) throw badInput("kind is required");
  if (!i.value.trim()) throw badInput("value is required");
  let componentId: string | null = null;
  if (i.componentSlug) {
    if (!i.productId)
      throw badInput(
        "a component needs its product — pass product_slug alongside component",
      );
    componentId = (await resolveComponentStrict(i.productId, i.componentSlug))
      .id;
  }
  const [row] = await sql`
    insert into customer_facts (customer_id, kind, label, value, notes, source, component_id)
    values (${customerId}, ${i.kind.trim()}, ${i.label?.trim() ?? ""}, ${i.value.trim()},
            ${i.notes ?? null}, ${i.source ?? null}, ${componentId})
    on conflict (customer_id, kind, label) do update set
      value        = excluded.value,
      notes        = coalesce(excluded.notes, customer_facts.notes),
      source       = coalesce(excluded.source, customer_facts.source),
      component_id = excluded.component_id
    returning id, kind, label, value
  `;
  return row;
}

export async function deleteCustomerFact(id: string) {
  const [row] =
    await sql`delete from customer_facts where id = ${id} returning id`;
  if (!row) throw notFound(`Customer fact '${id}' not found`);
  return { deleted: true, id };
}

export async function listCustomerFacts(customerId: string) {
  return sql`
    select f.id, f.kind, f.label, f.value, f.notes, f.source,
           f.component_id, c.slug as component_slug, f.updated_at
    from customer_facts f
    left join components c on c.id = f.component_id
    where f.customer_id = ${customerId}
    order by f.kind, f.label
  `;
}

/**
 * The `kind` values already in use, with counts. Same idea as listEnvironments:
 * the vocabulary is whatever this deployment needs, so it is reported rather than
 * enumerated, and callers reuse a value instead of coining a near-duplicate.
 */
export async function listCustomerFactKinds(): Promise<
  { kind: string; count: number }[]
> {
  const rows = await sql`
    select kind, count(*)::int as count from customer_facts
    group by kind order by count desc, kind
  `;
  return rows as unknown as { kind: string; count: number }[];
}

/** Record that a customer runs a component. Idempotent. */
export async function linkCustomerComponent(
  customerSlug: string,
  productId: string,
  componentSlug: string,
  notes?: string | null,
) {
  const customerId = await getCustomerIdBySlug(customerSlug);
  const component = await resolveComponentStrict(productId, componentSlug);
  await sql`
    insert into customer_components (customer_id, component_id, notes)
    values (${customerId}, ${component.id}, ${notes ?? null})
    on conflict (customer_id, component_id) do update set
      notes = coalesce(excluded.notes, customer_components.notes)
  `;
  return { customer: customerSlug, component: component.slug };
}

export async function unlinkCustomerComponent(
  customerSlug: string,
  productId: string,
  componentSlug: string,
) {
  const customerId = await getCustomerIdBySlug(customerSlug);
  const component = await resolveComponentStrict(productId, componentSlug);
  await sql`
    delete from customer_components
    where customer_id = ${customerId} and component_id = ${component.id}
  `;
  return { unlinked: true, customer: customerSlug, component: component.slug };
}

export async function listCustomerComponents(customerId: string) {
  return sql`
    select c.id, c.slug, c.name, c.product_id, p.slug as product_slug,
           cc.notes
    from customer_components cc
    join components c on c.id = cc.component_id
    join products p on p.id = c.product_id
    where cc.customer_id = ${customerId}
    order by p.slug, c.slug
  `;
}

export interface CustomerProfile {
  id: string;
  slug: string;
  name: string;
  notes: string | null;
  facts: {
    kind: string;
    label: string;
    value: string;
    component: string | null;
  }[];
  components: { slug: string; product_slug: string }[];
  repos: { slug: string; component: string | null; index_status: string }[];
  projects: { source_slug: string; external_key: string }[];
}

/**
 * Everything configured about one customer, in one read: the specifics of their
 * install plus the records that belong to them. This is what a ticket turn needs
 * BEFORE it reasons — their version and addons decide whether a general answer
 * even applies to them.
 */
export async function getCustomerProfile(
  customerId: string,
): Promise<CustomerProfile | null> {
  const [customer] = await sql`
    select id, slug, name, notes from customers where id = ${customerId}
  `;
  if (!customer) return null;
  const [facts, components, repos, projects] = await Promise.all([
    listCustomerFacts(customerId),
    listCustomerComponents(customerId),
    sql`
      select r.slug, c.slug as component_slug, r.index_status
      from repos r left join components c on c.id = r.component_id
      where r.customer_id = ${customerId} order by r.slug
    `,
    sql`
      select sc.slug as source_slug, sp.external_key
      from source_projects sp
      join source_connections sc on sc.id = sp.source_connection_id
      where sp.customer_id = ${customerId} order by sp.external_key
    `,
  ]);
  return {
    id: customer.id as string,
    slug: customer.slug as string,
    name: customer.name as string,
    notes: (customer.notes as string) ?? null,
    facts: facts.map((f) => ({
      kind: f.kind as string,
      label: f.label as string,
      value: f.value as string,
      component: (f.component_slug as string) ?? null,
    })),
    components: components.map((c) => ({
      slug: c.slug as string,
      product_slug: c.product_slug as string,
    })),
    repos: repos.map((r) => ({
      slug: r.slug as string,
      component: (r.component_slug as string) ?? null,
      index_status: r.index_status as string,
    })),
    projects: projects.map((p) => ({
      source_slug: p.source_slug as string,
      external_key: p.external_key as string,
    })),
  };
}
