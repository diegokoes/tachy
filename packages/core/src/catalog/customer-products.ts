/** The products a customer uses: what decides who may edit the customer. */
import { sql } from "../infra/db";
import { conflict } from "../infra/errors";
import type { ActorRef } from "../library/revisions";
import { inNewBatch, trackRecord, type WriteContext } from "./customer-history";

export async function listCustomerProducts(customerId: string) {
  return sql<{ slug: string; name: string; notes: string | null }[]>`
    select p.slug, p.name, cp.notes
    from customer_products cp join products p on p.id = cp.product_id
    where cp.customer_id = ${customerId}
    order by p.slug
  `;
}

/**
 * Record that a customer uses a product. Idempotent: linking again keeps the
 * stored notes unless new ones are given. `within` is the write that implies
 * the link (a unit or a component of the product), whose batch it joins.
 */
export async function linkCustomerProduct(
  customerId: string,
  productId: string,
  opts: { notes?: string | null; actor?: ActorRef; within?: WriteContext } = {},
) {
  const link = (ctx: WriteContext) =>
    trackRecord(
      ctx,
      "product",
      { customer_id: customerId, product_id: productId },
      () => ctx.db`
        insert into customer_products (customer_id, product_id, notes)
        values (${customerId}, ${productId}, ${opts.notes ?? null})
        on conflict (customer_id, product_id) do update set
          notes = coalesce(excluded.notes, customer_products.notes)
      `,
    );
  if (opts.within) await link(opts.within);
  else await inNewBatch(opts.actor, link);
  return { linked: true };
}

/** Refused while the customer has units of that product's setup. */
export async function unlinkCustomerProduct(
  customerId: string,
  productId: string,
  actor?: ActorRef,
) {
  const [units] = await sql<{ n: number }[]>`
    select count(*)::int as n from customer_units
    where customer_id = ${customerId} and product_id = ${productId}
  `;
  if (units.n > 0)
    throw conflict(
      `the customer has ${units.n} unit(s) in this product's setup: delete them or move them to another product first`,
      { units: units.n },
    );
  await inNewBatch(actor, (ctx) =>
    trackRecord(
      ctx,
      "product",
      { customer_id: customerId, product_id: productId },
      () => ctx.db`
        delete from customer_products
        where customer_id = ${customerId} and product_id = ${productId}
      `,
    ),
  );
  return { unlinked: true };
}
