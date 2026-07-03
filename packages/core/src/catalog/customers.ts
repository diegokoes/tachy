import { sql } from "../platform/db";
import { badInput } from "../platform/errors";

export interface CustomerInput {
  name: string;
  slug: string;
  aliases?: string[];    // other names / email domains that resolve to this customer
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

export async function resolveCustomerByEmail(email: string | undefined): Promise<string | null> {
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
  if (!row) throw badInput(`Unknown customer '${slug}'. Call list_customers, or add_customer first.`);
  return row.id as string;
}

export async function setWorkItemCustomer(workItemId: string, customerId: string | null) {
  await sql`update work_items set customer_id = ${customerId} where id = ${workItemId}`;
}

export async function setObservedVersion(workItemId: string, version: string | null) {
  await sql`update work_items set observed_version = ${version} where id = ${workItemId}`;
}

export async function getCustomerName(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const [row] = await sql`select name from customers where id = ${customerId}`;
  return row?.name ?? null;
}

export async function getCustomerSlug(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const [row] = await sql`select slug from customers where id = ${customerId}`;
  return row?.slug ?? null;
}
