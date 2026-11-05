import { Hono, type Context } from "hono";
import { z } from "zod";
import { validate } from "../../validation";
import {
  addUnitKind,
  deleteUnitKind,
  deleteUnitKindFact,
  getProductBlueprint,
  getProductIdBySlug,
  setUnitKindFact,
  updateUnitKind,
  updateUnitKindFact,
} from "@tachy/core/catalog";
import { audited } from "../../audit";
import { assertScopeEditor } from "../../authz";

const kindFactSchema = z.object({
  kind: z.string().min(1),
  description: z.string().nullable().optional(),
  choices: z.array(z.string()).optional(),
  position: z.number().int().optional(),
});

const kindFactPatchSchema = kindFactSchema.partial();

const unitKindSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  parent_kind: z.string().nullable().optional(),
  template_kind: z.string().nullable().optional(),
  position: z.number().int().optional(),
  facts: z.array(kindFactSchema).optional(),
});

const unitKindPatchSchema = unitKindSchema.omit({ facts: true }).partial();

/** Resolves the product and checks the caller curates it. */
async function editableProduct(c: Context): Promise<string> {
  const productId = await getProductIdBySlug(c.req.param("slug")!);
  await assertScopeEditor(c, { productId });
  return productId;
}

const kindTarget = (c: Context) =>
  `blueprint:${c.req.param("slug")}/${c.req.param("kind")}`;

/** A product's blueprint: its unit kinds and the facts each records. */
export const blueprints = new Hono()
  .get("/products/:slug/blueprint", async (c) =>
    c.json(
      await getProductBlueprint(await getProductIdBySlug(c.req.param("slug"))),
    ),
  )
  .put(
    "/products/:slug/blueprint/kinds",
    validate("json", unitKindSchema),
    async (c) => {
      const productId = await editableProduct(c);
      const body = c.req.valid("json");
      return c.json(
        await audited(
          c,
          "catalog_add",
          `blueprint:${c.req.param("slug")}/${body.slug}`,
          () =>
            addUnitKind({
              productId,
              slug: body.slug,
              name: body.name,
              description: body.description,
              parentKind: body.parent_kind,
              templateKind: body.template_kind,
              position: body.position,
              facts: body.facts,
            }),
        ),
      );
    },
  )
  .patch(
    "/products/:slug/blueprint/kinds/:kind",
    validate("json", unitKindPatchSchema),
    async (c) => {
      const productId = await editableProduct(c);
      const body = c.req.valid("json");
      return c.json(
        await audited(c, "catalog_update", kindTarget(c), () =>
          updateUnitKind(productId, c.req.param("kind"), {
            ...(body.slug !== undefined ? { slug: body.slug } : {}),
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...("description" in body ? { description: body.description } : {}),
            ...("parent_kind" in body ? { parentKind: body.parent_kind } : {}),
            ...("template_kind" in body
              ? { templateKind: body.template_kind }
              : {}),
            ...(body.position !== undefined ? { position: body.position } : {}),
          }),
        ),
      );
    },
  )
  .delete("/products/:slug/blueprint/kinds/:kind", async (c) => {
    const productId = await editableProduct(c);
    return c.json(
      await audited(c, "catalog_delete", kindTarget(c), () =>
        deleteUnitKind(productId, c.req.param("kind")),
      ),
    );
  })
  .put(
    "/products/:slug/blueprint/kinds/:kind/facts",
    validate("json", kindFactSchema),
    async (c) => {
      const productId = await editableProduct(c);
      const body = c.req.valid("json");
      return c.json(
        await audited(
          c,
          "catalog_update",
          kindTarget(c),
          () => setUnitKindFact(productId, c.req.param("kind"), body),
          { fact_set: body.kind },
        ),
      );
    },
  )
  .patch(
    "/products/:slug/blueprint/kinds/:kind/facts/:fact",
    validate("json", kindFactPatchSchema),
    async (c) => {
      const productId = await editableProduct(c);
      return c.json(
        await audited(
          c,
          "catalog_update",
          kindTarget(c),
          () =>
            updateUnitKindFact(
              productId,
              c.req.param("kind"),
              c.req.param("fact"),
              c.req.valid("json"),
            ),
          { fact_updated: c.req.param("fact") },
        ),
      );
    },
  )
  .delete("/products/:slug/blueprint/kinds/:kind/facts/:fact", async (c) => {
    const productId = await editableProduct(c);
    return c.json(
      await audited(
        c,
        "catalog_update",
        kindTarget(c),
        () =>
          deleteUnitKindFact(
            productId,
            c.req.param("kind"),
            c.req.param("fact"),
          ),
        { fact_deleted: c.req.param("fact") },
      ),
    );
  });
