import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  getProductIdBySlug,
  getCustomerIdBySlug,
  getCustomerProfile,
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
  listCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
} from "@tachy/core/catalog";
import { badInput } from "@tachy/core/infra";
import { audited } from "../../audit";
import { assertAnyTeamAdminApi } from "../../authz";
import { slugField } from "./catalog";

const customerSchema = z.object({
  name: z.string(),
  slug: slugField,
  aliases: z.array(z.string()).optional(),
  emailDomains: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const customerUnitSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  parent: z.string().nullable().optional(),
  profile: z.string().nullable().optional(),
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

const customerPatchSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  emailDomains: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Customers, the units of their estate, and the facts and components that are
 * theirs.
 */
export const customers = new Hono()
  .get("/customers", async (c) => c.json(await listCustomers()))
  .post("/customers", zValidator("json", customerSchema), async (c) => {
    await assertAnyTeamAdminApi(c);
    const body = c.req.valid("json");
    return c.json(
      await audited(c, "catalog_add", `customer:${body.slug}`, () =>
        addCustomer(body),
      ),
    );
  })
  .patch(
    "/customers/:slug",
    zValidator("json", customerPatchSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const slug = c.req.param("slug");
      return c.json(
        await audited(c, "catalog_update", `customer:${slug}`, () =>
          updateCustomer(slug, c.req.valid("json")),
        ),
      );
    },
  )
  .delete("/customers/:slug", async (c) => {
    await assertAnyTeamAdminApi(c);
    const slug = c.req.param("slug");
    return c.json(
      await audited(c, "catalog_delete", `customer:${slug}`, () =>
        deleteCustomer(slug),
      ),
    );
  })

  // The customer's own install: their specifics, plus the records that are theirs.
  // ?unit= resolves the facts for one part of their estate, each carrying where
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
    zValidator("json", customerUnitSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const body = c.req.valid("json");
      return c.json(
        await audited(
          c,
          "catalog_add",
          `unit:${c.req.param("slug")}/${body.slug}`,
          () =>
            addCustomerUnit({
              customerSlug: c.req.param("slug"),
              slug: body.slug,
              name: body.name,
              kind: body.kind,
              parentSlug: body.parent,
              profileSlug: body.profile,
              aliases: body.aliases,
              notes: body.notes,
            }),
        ),
      );
    },
  )
  .patch(
    "/customers/:slug/units/:unit",
    zValidator("json", customerUnitPatchSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const body = c.req.valid("json");
      const target = `unit:${c.req.param("slug")}/${c.req.param("unit")}`;
      return c.json(
        await audited(c, "catalog_update", target, async () =>
          updateCustomerUnit(
            await getCustomerIdBySlug(c.req.param("slug")),
            c.req.param("unit"),
            {
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.kind !== undefined ? { kind: body.kind } : {}),
              ...("parent" in body ? { parentSlug: body.parent } : {}),
              ...("profile" in body ? { profileSlug: body.profile } : {}),
              ...(body.aliases !== undefined ? { aliases: body.aliases } : {}),
              ...("notes" in body ? { notes: body.notes } : {}),
            },
          ),
        ),
      );
    },
  )
  .delete("/customers/:slug/units/:unit", async (c) => {
    await assertAnyTeamAdminApi(c);
    const target = `unit:${c.req.param("slug")}/${c.req.param("unit")}`;
    return c.json(
      await audited(c, "catalog_delete", target, async () =>
        deleteCustomerUnit(
          await getCustomerIdBySlug(c.req.param("slug")),
          c.req.param("unit"),
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
  .put(
    "/customers/:slug/facts",
    zValidator("json", customerFactSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const body = c.req.valid("json");
      // The kind and label name the fact; its value is the customer's own
      // data and stays out of the trail.
      return c.json(
        await audited(
          c,
          "catalog_update",
          `customer:${c.req.param("slug")}`,
          async () =>
            setCustomerFact({
              customerSlug: c.req.param("slug"),
              unit: body.unit,
              kind: body.kind,
              label: body.label,
              value: body.value,
              notes: body.notes,
              source: body.source,
              componentSlug: body.component,
              productId: body.product_slug
                ? await getProductIdBySlug(body.product_slug)
                : null,
            }),
          { fact_set: body.kind, label: body.label, unit: body.unit },
        ),
      );
    },
  )
  .delete("/customers/:slug/facts/:id", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(
      await audited(
        c,
        "catalog_update",
        `customer:${c.req.param("slug")}`,
        () => deleteCustomerFact(c.req.param("id")),
        { fact_deleted: c.req.param("id") },
      ),
    );
  })
  .put(
    "/customers/:slug/components",
    zValidator("json", customerComponentSchema),
    async (c) => {
      await assertAnyTeamAdminApi(c);
      const body = c.req.valid("json");
      return c.json(
        await audited(
          c,
          "catalog_update",
          `customer:${c.req.param("slug")}`,
          async () =>
            linkCustomerComponent(
              c.req.param("slug"),
              await getProductIdBySlug(body.product_slug),
              body.component,
              body.notes,
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
    return c.json(
      await audited(
        c,
        "catalog_update",
        `customer:${c.req.param("slug")}`,
        async () =>
          unlinkCustomerComponent(
            c.req.param("slug"),
            await getProductIdBySlug(productSlug),
            component,
          ),
        { component_unlinked: `${productSlug}/${component}` },
      ),
    );
  });
