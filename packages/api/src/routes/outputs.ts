import { Hono } from "hono";
import { getOutput, listOutputs, deleteOutput } from "@tachy/core";
import { requireCaller } from "../authz";

/** RFC 5987, so a filename with non-ASCII survives the header. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const outputs = new Hono()

  .get("/", async (c) => {
    const userId = await requireCaller(c);
    return c.json(await listOutputs(userId));
  })

  .get("/:id/download", async (c) => {
    const userId = await requireCaller(c);
    const row = await getOutput(c.req.param("id"), userId);
    c.header("content-type", row.mime);
    c.header("content-disposition", contentDisposition(row.filename));
    c.header("content-length", String(row.byte_size));
    c.header("cache-control", "private, no-store");
    return c.body(
      row.bytes.buffer.slice(
        row.bytes.byteOffset,
        row.bytes.byteOffset + row.bytes.byteLength,
      ) as ArrayBuffer,
    );
  })

  .delete("/:id", async (c) => {
    const userId = await requireCaller(c);
    return c.json({
      ok: true,
      deleted: await deleteOutput(c.req.param("id"), userId),
    });
  });
