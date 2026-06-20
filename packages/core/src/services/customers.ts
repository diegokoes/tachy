import { sql } from "../db";

export interface CustomerInput {
  name: string;
  slug: string;
  aliases?: string[];    // other names / email domains that resolve to this customer
  notes?: string;
}

/** The full customer list, mainly so a correction can pick an existing one instead of guessing a slug. */
export async function listCustomers() {
  return sql`select id, name, slug, aliases, notes from customers order by name`;
}

/** Deliberately add (or extend) a customer — e.g. a distributor alias like Arvato fronting for Davidoff. */
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

/** Match an email's domain against customers.aliases. Returns the customer id, or null on no match. */
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

/** Resolve a customer slug to its id, for correction tools that take a human-friendly slug. */
export async function getCustomerIdBySlug(slug: string): Promise<string> {
  const [row] = await sql`select id from customers where slug = ${slug}`;
  if (!row) throw new Error(`Unknown customer '${slug}'. Call list_customers, or add_customer first.`);
  return row.id as string;
}

/** Manual correction: attach (or clear) a work item's resolved customer. */
export async function setWorkItemCustomer(workItemId: string, customerId: string | null) {
  await sql`update work_items set customer_id = ${customerId} where id = ${workItemId}`;
}

/** Manual correction: record the version observed on a specific ticket. */
export async function setObservedVersion(workItemId: string, version: string | null) {
  await sql`update work_items set observed_version = ${version} where id = ${workItemId}`;
}

/** Resolve a customer's canonical display name, for surfacing alongside ticket context. */
export async function getCustomerName(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const [row] = await sql`select name from customers where id = ${customerId}`;
  return row?.name ?? null;
}
