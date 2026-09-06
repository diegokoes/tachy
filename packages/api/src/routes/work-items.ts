import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  resolveSource,
  ingestWorkItem,
  recordRun,
  getCustomerName,
  getCustomerIdBySlug,
  setWorkItemCustomer,
  setObservedVersion,
  badInput,
  workItemScope,
  externalWorkItemScope,
} from "@tachy/core";
import { assertScopeEditor, callerScope } from "../authz";

const customerSchema = z.object({
  customer_slug: z.string().nullable(),
  /** Which part of their estate. Ignored when the customer is being cleared. */
  unit: z.string().nullable().optional(),
});
const versionSchema = z.object({ version: z.string().nullable() });
const noteSchema = z.object({ body: z.string().min(1) });

export const workItems = new Hono()
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
  /*
   * A note goes onto the customer's own ticket, under the org's shared
   * credential — the most externally visible thing this API does, so it is held
   * to the same scope check as editing the item it hangs off.
   */
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
