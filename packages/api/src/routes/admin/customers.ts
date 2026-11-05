import { Hono, type Context } from "hono";
import { validate } from "../../validation";
import { z } from "zod";
import {
  getProductIdBySlug,
  getCustomerIdBySlug,
  getCustomerProfile,
  getCustomerFact,
  listCustomerUnits,
  addCustomerUnit,
  updateCustomerUnit,
  deleteCustomerUnit,
  resolveUnitFacts,
  resolveUnit,
  setCustomerFact,
  deleteCustomerFact,
  listCustomerFactKinds,
  listCustomerFacts,
  linkCustomerComponent,
  unlinkCustomerComponent,
  linkCustomerProduct,
  unlinkCustomerProduct,
  listCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  resolveComponentStrict,
  batchScope,
  listCustomerChanges,
  listDeletedCustomers,
  restoreCustomerBatch,
} from "@tachy/core/catalog";
import { badInput } from "@tachy/core/infra";
import { audited } from "../../audit";
import {
  assertAnyTeamAdminApi,
  assertCustomerEditor,
  assertScopeEditor,
  callerActor,
} from "../../authz";
import { slugField } from "./catalog";

const customerSchema = z.object({
  name: z.string(),
  slug: slugField,
  aliases: z.array(z.string()).optional(),
  emailDomains: z.array(z.string()).optional(),
  notes: z.string().optional(),
  /** Product slugs the customer uses; each needs the caller's rights on it. */
  products: z.array(z.string().min(1)).optional(),
});

const customerUnitSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  /** The product whose setup the unit belongs to; null for a general unit. */
  product: z.string().nullable().optional(),
  parent: z.string().nullable().optional(),
  template: z.string().nullable().optional(),
  aliases: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

const customerUnitPatchSchema = customerUnitSchema
  .partial()
  .omit({ slug: true });

const customerFactSchema = z.object({
  unit: z.string().nullable().optional(),
  kind: z.string().min(1),
  label: z.string().optional(),
  value: z.string().min(1),
  notes: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  product_slug: z.string().optional(),
  component: z.string().optional(),
});

const customerComponentSchema = z.object({
  product_slug: z.string(),
  component: z.string(),
  notes: z.string().nullable().optional(),
});

const customerProductSchema = z.object({
  notes: z.string().nullable().optional(),
});

const batchParam = z.object({ batch: z.string().uuid() });

const customerPatchSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  emailDomains: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

const productIdOrNull = async (slug: string | null | undefined) =>
  slug ? getProductIdBySlug(slug) : null;

/**
 * A part of a customer tied to a product is edited under that product's scope;
 * the customer's own record and its general parts under the customer's rights.
 */
async function assertPartEditor(
  c: Context,
  customerId: string,
  productId: string | null,
): Promise<void> {
  if (productId) await assertScopeEditor(c, { productId });
  else await assertCustomerEditor(c, customerId);
}

/**
 * Customers, the products they use, the units of their setups, and the facts
 * and components that are theirs.
 */
export const customers = new Hono()
  .get("/customers", async (c) => {
    const product = c.req.query("product");
    const component = c.req.query("component");
    if (component && !product)
      throw badInput("component resolves within a product: pass product too");
    const productId = product ? await getProductIdBySlug(product) : undefined;
    const componentId =
      component && productId
        ? (await resolveComponentStrict(productId, component)).id
        : undefined;
    return c.json(await listCustomers({ productId, componentId }));
  })
  .post("/customers", validate("json", customerSchema), async (c) => {
    await assertAnyTeamAdminApi(c);
    const { products, ...body } = c.req.valid("json");
    const productIds: string[] = [];
    for (const product of products ?? []) {
      const productId = await getProductIdBySlug(product);
      await assertScopeEditor(c, { productId });
      productIds.push(productId);
    }
    return c.json(
      await audited(c, "catalog_add", `customer:${body.slug}`, async () =>
        addCustomer({ ...body, productIds }, await callerActor(c)),
      ),
    );
  })
  .patch(
    "/customers/:slug",
    validate("json", customerPatchSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const slug = c.req.param("slug");
      await assertCustomerEditor(c, await getCustomerIdBySlug(slug));
      const actor = await callerActor(c);
      return c.json(
        await audited(c, "catalog_update", `customer:${slug}`, () =>
          updateCustomer(slug, c.req.valid("json"), actor),
        ),
      );
    },
  )
  .delete("/customers/:slug", async (c) => {
    await assertAnyTeamAdminApi(c);
    const slug = c.req.param("slug");
    await assertCustomerEditor(c, await getCustomerIdBySlug(slug));
    const actor = await callerActor(c);
    return c.json(
      await audited(c, "catalog_delete", `customer:${slug}`, () =>
        deleteCustomer(slug, actor),
      ),
    );
  })

  // Linking a product is how a team claims a customer: its own product, on any
  // customer.
  .put(
    "/customers/:slug/products/:product",
    validate("json", customerProductSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const customerId = await getCustomerIdBySlug(c.req.param("slug"));
      const productId = await getProductIdBySlug(c.req.param("product"));
      await assertScopeEditor(c, { productId });
      const actor = await callerActor(c);
      return c.json(
        await audited(
          c,
          "catalog_update",
          `customer:${c.req.param("slug")}`,
          () =>
            linkCustomerProduct(customerId, productId, {
              notes: c.req.valid("json").notes,
              actor,
            }),
          { product_linked: c.req.param("product") },
        ),
      );
    },
  )
  .delete("/customers/:slug/products/:product", async (c) => {
    await assertAnyTeamAdminApi(c);
    const customerId = await getCustomerIdBySlug(c.req.param("slug"));
    const productId = await getProductIdBySlug(c.req.param("product"));
    await assertScopeEditor(c, { productId });
    return c.json(
      await audited(
        c,
        "catalog_update",
        `customer:${c.req.param("slug")}`,
        async () =>
          unlinkCustomerProduct(customerId, productId, await callerActor(c)),
        { product_unlinked: c.req.param("product") },
      ),
    );
  })

  // The customer's own install: their specifics, plus the records that are theirs.
  // ?unit= resolves the facts for one part of their setup, each carrying where
  // it came from, instead of listing the customer's flat set.
  .get("/customers/:slug/profile", async (c) =>
    c.json(
      await getCustomerProfile(
        await getCustomerIdBySlug(c.req.param("slug")),
        c.req.query("unit") ?? null,
      ),
    ),
  )
  .get("/customers/:slug/units", async (c) =>
    c.json(
      await listCustomerUnits(await getCustomerIdBySlug(c.req.param("slug"))),
    ),
  )
  .put(
    "/customers/:slug/units",
    validate("json", customerUnitSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const body = c.req.valid("json");
      const customerId = await getCustomerIdBySlug(c.req.param("slug"));
      const productId = await productIdOrNull(body.product);
      await assertPartEditor(c, customerId, productId);
      return c.json(
        await audited(
          c,
          "catalog_add",
          `unit:${c.req.param("slug")}/${body.slug}`,
          async () =>
            addCustomerUnit(
              {
                customerSlug: c.req.param("slug"),
                slug: body.slug,
                name: body.name,
                kind: body.kind,
                productId,
                parentSlug: body.parent,
                templateSlug: body.template,
                aliases: body.aliases,
                notes: body.notes,
              },
              await callerActor(c),
            ),
        ),
      );
    },
  )
  .patch(
    "/customers/:slug/units/:unit",
    validate("json", customerUnitPatchSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const body = c.req.valid("json");
      const customerId = await getCustomerIdBySlug(c.req.param("slug"));
      const current = await resolveUnit(customerId, c.req.param("unit"));
      await assertPartEditor(c, customerId, current.product_id);
      const productId =
        "product" in body
          ? await productIdOrNull(body.product)
          : current.product_id;
      if (productId !== current.product_id)
        await assertPartEditor(c, customerId, productId);
      const target = `unit:${c.req.param("slug")}/${c.req.param("unit")}`;
      return c.json(
        await audited(c, "catalog_update", target, async () =>
          updateCustomerUnit(
            customerId,
            c.req.param("unit"),
            {
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.kind !== undefined ? { kind: body.kind } : {}),
              ...("product" in body ? { productId } : {}),
              ...("parent" in body ? { parentSlug: body.parent } : {}),
              ...("template" in body ? { templateSlug: body.template } : {}),
              ...(body.aliases !== undefined ? { aliases: body.aliases } : {}),
              ...("notes" in body ? { notes: body.notes } : {}),
            },
            await callerActor(c),
          ),
        ),
      );
    },
  )
  .delete("/customers/:slug/units/:unit", async (c) => {
    await assertAnyTeamAdminApi(c);
    const customerId = await getCustomerIdBySlug(c.req.param("slug"));
    const current = await resolveUnit(customerId, c.req.param("unit"));
    await assertPartEditor(c, customerId, current.product_id);
    const target = `unit:${c.req.param("slug")}/${c.req.param("unit")}`;
    return c.json(
      await audited(c, "catalog_delete", target, async () =>
        deleteCustomerUnit(
          customerId,
          c.req.param("unit"),
          await callerActor(c),
        ),
      ),
    );
  })
  // The resolved ladder for one unit, each fact carrying where it came from.
  .get("/customers/:slug/units/:unit/facts", async (c) => {
    const customerId = await getCustomerIdBySlug(c.req.param("slug"));
    const unit = await resolveUnit(customerId, c.req.param("unit"));
    return c.json(await resolveUnitFacts(unit.id));
  })
  .get("/customers/:slug/facts", async (c) =>
    c.json(
      await listCustomerFacts(await getCustomerIdBySlug(c.req.param("slug"))),
    ),
  )
  .get("/customer-fact-kinds", async (c) =>
    c.json(await listCustomerFactKinds()),
  )
  .get("/customers/:slug/history", async (c) =>
    c.json(
      await listCustomerChanges(await getCustomerIdBySlug(c.req.param("slug"))),
    ),
  )
  .get("/customer-history/deleted", async (c) =>
    c.json(await listDeletedCustomers()),
  )
  // Undoing a batch takes the rights of every write in it: each product's
  // scope, and the customer's own record for the rest.
  .post(
    "/customer-history/:batch/restore",
    validate("param", batchParam),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const { batch } = c.req.valid("param");
      const scope = await batchScope(batch);
      for (const productId of scope.productIds)
        await assertScopeEditor(c, { productId });
      if (scope.touchesCustomer)
        await assertCustomerEditor(c, scope.customerId);
      return c.json(
        await audited(
          c,
          "catalog_update",
          `customer-history:${batch}`,
          async () => restoreCustomerBatch(batch, await callerActor(c)),
          { restored: batch },
        ),
      );
    },
  )
  .put(
    "/customers/:slug/facts",
    validate("json", customerFactSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const body = c.req.valid("json");
      const customerId = await getCustomerIdBySlug(c.req.param("slug"));
      const unit = body.unit ? await resolveUnit(customerId, body.unit) : null;
      await assertPartEditor(c, customerId, unit?.product_id ?? null);
      // The kind and label name the fact; its value is the customer's own
      // data and stays out of the trail.
      return c.json(
        await audited(
          c,
          "catalog_update",
          `customer:${c.req.param("slug")}`,
          async () =>
            setCustomerFact(
              {
                customerSlug: c.req.param("slug"),
                unit: body.unit,
                kind: body.kind,
                label: body.label,
                value: body.value,
                notes: body.notes,
                source: body.source,
                componentSlug: body.component,
                productId: await productIdOrNull(body.product_slug),
              },
              await callerActor(c),
            ),
          { fact_set: body.kind, label: body.label, unit: body.unit },
        ),
      );
    },
  )
  .delete("/customers/:slug/facts/:id", async (c) => {
    await assertAnyTeamAdminApi(c);
    const customerId = await getCustomerIdBySlug(c.req.param("slug"));
    const fact = await getCustomerFact(customerId, c.req.param("id"));
    await assertPartEditor(c, customerId, fact.product_id);
    return c.json(
      await audited(
        c,
        "catalog_update",
        `customer:${c.req.param("slug")}`,
        async () =>
          deleteCustomerFact(customerId, fact.id, await callerActor(c)),
        { fact_deleted: fact.id },
      ),
    );
  })
  .put(
    "/customers/:slug/components",
    validate("json", customerComponentSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const body = c.req.valid("json");
      const productId = await getProductIdBySlug(body.product_slug);
      await assertScopeEditor(c, { productId });
      return c.json(
        await audited(
          c,
          "catalog_update",
          `customer:${c.req.param("slug")}`,
          async () =>
            linkCustomerComponent(
              c.req.param("slug"),
              productId,
              body.component,
              {
                notes: body.notes,
                actor: await callerActor(c),
              },
            ),
          { component_linked: `${body.product_slug}/${body.component}` },
        ),
      );
    },
  )
  .delete("/customers/:slug/components", async (c) => {
    await assertAnyTeamAdminApi(c);
    const productSlug = c.req.query("product_slug");
    const component = c.req.query("component");
    if (!productSlug || !component)
      throw badInput("product_slug and component are required");
    const productId = await getProductIdBySlug(productSlug);
    await assertScopeEditor(c, { productId });
    return c.json(
      await audited(
        c,
        "catalog_update",
        `customer:${c.req.param("slug")}`,
        async () =>
          unlinkCustomerComponent(
            c.req.param("slug"),
            productId,
            component,
            await callerActor(c),
          ),
        { component_unlinked: `${productSlug}/${component}` },
      ),
    );
  });
