import { sql } from "../platform/db";
import { badInput, conflict, notFound } from "../platform/errors";

export interface CustomerInput {
  name: string;
  slug: string;
  aliases?: string[];
  notes?: string;
}

export async function listCustomers() {
  return sql`select id, name, slug, aliases, notes from customers order by name`;
}

export async function addCustomer(i: CustomerInput) {
  const [row] = await sql`
    insert into customers (name, slug, aliases, notes)
    values (${i.name}, ${i.slug}, ${i.aliases ?? []}, ${i.notes ?? null})
    on conflict (slug) do update set
      name = excluded.name,
      aliases = excluded.aliases,
      notes = coalesce(excluded.notes, customers.notes)
    returning id, name, slug
  `;
  return row;
}

export async function updateCustomer(
  slug: string,
  patch: { name?: string; aliases?: string[]; notes?: string | null },
) {
  const [current] =
    await sql`select id, name, aliases, notes from customers where slug = ${slug}`;
  if (!current) throw notFound(`Customer '${slug}' not found`);
  const [row] = await sql`
    update customers set
      name    = ${patch.name ?? current.name},
      aliases = ${patch.aliases ?? current.aliases},
      notes   = ${"notes" in patch ? patch.notes : current.notes}
    where id = ${current.id}
    returning id, name, slug, aliases, notes
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

export async function resolveCustomerByEmail(
  email: string | undefined,
): Promise<string | null> {
  if (!email) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const [row] = await sql`
    select id from customers
    where ${domain} = any(aliases) or lower(slug) = ${domain}
    limit 1
  `;
  return row?.id ?? null;
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
