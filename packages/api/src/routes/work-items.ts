import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { resolveSource } from "@tachy/core/sources";
import {
  deleteStoredItems,
  filterForAudit,
  ingestWorkItem,
  previewStoredItems,
  workItemScope,
  externalWorkItemScope,
  type StoredItemFilter,
} from "@tachy/core/work-items";
import { recordRun } from "@tachy/core/analytics";
import {
  getCustomerName,
  getCustomerIdBySlug,
  setWorkItemCustomer,
  setObservedVersion,
} from "@tachy/core/catalog";
import { badInput } from "@tachy/core/infra";
import { audit } from "../audit";
import { requireAdmin } from "../auth";
import { assertScopeEditor, callerScope } from "../authz";

const customerSchema = z.object({
  customer_slug: z.string().nullable(),
  /** Which part of their estate. Ignored when the customer is being cleared. */
  unit: z.string().nullable().optional(),
});
const versionSchema = z.object({ version: z.string().nullable() });
const noteSchema = z.object({ body: z.string().min(1) });

const storedFilterSchema = z.object({
  connection: z.string().min(1).optional(),
  statuses: z.array(z.string().min(1)).optional(),
  product: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
  customer: z.string().min(1).optional(),
  requester: z.string().min(1).optional(),
  changed_before: z.string().min(1).optional(),
  include_learned_from: z.boolean().optional(),
});
const storedDeleteSchema = storedFilterSchema.extend({
  /** The `matched` a preview of the same filter returned. */
  expected: z.number().int().min(0),
});

const storedFilter = (
  body: z.infer<typeof storedFilterSchema>,
): StoredItemFilter => ({
  connection: body.connection,
  statuses: body.statuses,
  product: body.product,
  team: body.team,
  customer: body.customer,
  requester: body.requester,
  changedBefore: body.changed_before,
  includeLearnedFrom: body.include_learned_from,
});

export const workItems = new Hono()
  // The stored copies of tickets, by filter. A preview first: the delete takes
  // the count the preview gave and refuses when it no longer holds.
  .post(
    "/stored/preview",
    requireAdmin,
    zValidator("json", storedFilterSchema),
    async (c) =>
      c.json(await previewStoredItems(storedFilter(c.req.valid("json")))),
  )
  .post(
    "/stored/delete",
    requireAdmin,
    zValidator("json", storedDeleteSchema),
    async (c) => {
      const { expected, ...body } = c.req.valid("json");
      const filter = storedFilter(body);
      const cleanup = await deleteStoredItems(filter, expected);
      await audit(
        c,
        "work_items_cleanup",
        filter.connection ?? "every connection",
        { ...filterForAudit(filter), ...cleanup },
      );
      return c.json(cleanup);
    },
  )

  .post("/:source/:id/fetch", async (c) => {
    const { source, id } = c.req.param();
    const { conn, source: src } = await resolveSource(
      source,
      await callerScope(c),
    );
    const raw = await src.fetchItem(id);
    const item = await ingestWorkItem(conn.id, raw);
    await recordRun({ workItemId: item.id, mode: "ingest" });
    const customerName = await getCustomerName(item.customerId);
    return c.json({
      work_item_id: item.id,
      product_id: item.productId,
      team_id: item.teamId,
      customer_id: item.customerId,
      customer_name: customerName,
      observed_version: item.observedVersion,
      item: raw,
    });
  })
  // A note goes onto the customer's own ticket, under the org's shared
  // credential: the most externally visible thing this API does, so it is held
  // to the same scope check as editing the item it hangs off.
  .post("/:source/:id/notes", zValidator("json", noteSchema), async (c) => {
    const { source, id } = c.req.param();
    const { body } = c.req.valid("json");
    const { conn, source: src } = await resolveSource(
      source,
      await callerScope(c),
    );
    await assertScopeEditor(c, await externalWorkItemScope(conn.id, id));
    if (!src.postNote) throw badInput("notes unsupported for this source");
    await src.postNote(id, body, { private: true });
    return c.json({ posted: true });
  })
  .patch("/:id/customer", zValidator("json", customerSchema), async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await workItemScope(id));
    const { customer_slug, unit } = c.req.valid("json");
    const customerId = customer_slug
      ? await getCustomerIdBySlug(customer_slug)
      : null;
    await setWorkItemCustomer(id, customerId, unit);
    return c.json({ updated: true, customer_id: customerId });
  })
  .patch(
    "/:id/observed-version",
    zValidator("json", versionSchema),
    async (c) => {
      const id = c.req.param("id");
      await assertScopeEditor(c, await workItemScope(id));
      const { version } = c.req.valid("json");
      await setObservedVersion(id, version);
      return c.json({ updated: true, observed_version: version });
    },
  );
