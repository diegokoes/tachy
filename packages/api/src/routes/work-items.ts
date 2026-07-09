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
} from "@tachy/core";

const customerSchema = z.object({ customer_slug: z.string().nullable() });
const versionSchema = z.object({ version: z.string().nullable() });
const noteSchema = z.object({ body: z.string().min(1) });

export const workItems = new Hono()
  .post("/:source/:id/fetch", async (c) => {
    const { source, id } = c.req.param();
    const { conn, source: src } = await resolveSource(source);
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
  .post("/:source/:id/notes", zValidator("json", noteSchema), async (c) => {
    const { source, id } = c.req.param();
    const { body } = c.req.valid("json");
    const { source: src } = await resolveSource(source);
    if (!src.postNote) throw badInput("notes unsupported for this source");
    await src.postNote(id, body, { private: true });
    return c.json({ posted: true });
  })
  .patch("/:id/customer", zValidator("json", customerSchema), async (c) => {
    const { customer_slug } = c.req.valid("json");
    const customerId = customer_slug
      ? await getCustomerIdBySlug(customer_slug)
      : null;
    await setWorkItemCustomer(c.req.param("id"), customerId);
    return c.json({ updated: true, customer_id: customerId });
  })
  .patch(
    "/:id/observed-version",
    zValidator("json", versionSchema),
    async (c) => {
      const { version } = c.req.valid("json");
      await setObservedVersion(c.req.param("id"), version);
      return c.json({ updated: true, observed_version: version });
    },
  );
