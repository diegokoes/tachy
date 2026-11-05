/**
 * Finding customer data by what it says: which customers run SAP, where line
 * TLC191 is, who records coding mode CT2. Substring matches, ranked by
 * trigram similarity, in three groups.
 */
import type { CustomerSearchHits } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput } from "../infra/errors";

/** Each group is a short answer to read, not a listing to page through. */
const HITS_PER_GROUP = 10;

/** `%` and `_` in the query are text, not wildcards. */
const containing = (query: string) =>
  `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

export async function searchCustomers(
  query: string,
  opts: { productId?: string } = {},
): Promise<CustomerSearchHits> {
  const needle = query.trim();
  if (!needle) throw badInput("query is required");
  const pattern = containing(needle);
  const inProduct = (customerColumn: ReturnType<typeof sql>) =>
    opts.productId
      ? sql`and exists (select 1 from customer_products cp
                        where cp.customer_id = ${customerColumn}
                          and cp.product_id = ${opts.productId})`
      : sql``;

  const [customers, units, facts] = await Promise.all([
    sql<CustomerSearchHits["customers"]>`
      select c.slug, c.name
      from customers c
      where (c.name ilike ${pattern} or c.slug ilike ${pattern}
             or exists (select 1 from unnest(c.aliases) a where a ilike ${pattern})
             or exists (select 1 from unnest(c.email_domains) d where d ilike ${pattern}))
        ${inProduct(sql`c.id`)}
      order by similarity(c.name, ${needle}) desc, c.name
      limit ${HITS_PER_GROUP}
    `,
    sql<CustomerSearchHits["units"]>`
      select c.slug as customer, u.slug, u.name, u.kind, p.slug as product
      from customer_units u
      join customers c on c.id = u.customer_id
      left join products p on p.id = u.product_id
      where (u.name ilike ${pattern} or u.slug ilike ${pattern}
             or u.kind ilike ${pattern}
             or exists (select 1 from unnest(u.aliases) a where a ilike ${pattern}))
        ${opts.productId ? sql`and u.product_id = ${opts.productId}` : sql``}
      order by similarity(u.name, ${needle}) desc, c.slug, u.slug
      limit ${HITS_PER_GROUP}
    `,
    sql<CustomerSearchHits["facts"]>`
      select c.slug as customer, u.slug as unit, f.kind, f.label, f.value
      from customer_facts f
      join customers c on c.id = f.customer_id
      left join customer_units u on u.id = f.unit_id
      where (f.value ilike ${pattern} or f.kind ilike ${pattern}
             or f.label ilike ${pattern})
        ${
          opts.productId
            ? sql`and (u.product_id = ${opts.productId}
                       or (f.unit_id is null ${inProduct(sql`c.id`)}))`
            : sql``
        }
      order by similarity(f.value, ${needle}) desc, c.slug, f.kind
      limit ${HITS_PER_GROUP}
    `,
  ]);
  return {
    customers: [...customers],
    units: [...units],
    facts: [...facts],
  };
}
