import { Hono } from "hono";
import { listReferenceDocs, getReferenceDoc, searchReferenceDocs } from "@tachy/core";

const csv = (v: string | undefined) => v?.split(",").map((t) => t.trim()).filter(Boolean);

// Read surface for reference docs (freeform project context). Save/update stay
// agent-driven via MCP; the UI only needs to browse, fetch, and semantic-search.
export const reference = new Hono()
  .get("/search", async (c) => {
    const tags = csv(c.req.query("tags"));
    const rows = await searchReferenceDocs(c.req.query("q") ?? "", {
      productId: c.req.query("product_id"),
      teamId: c.req.query("team_id"),
      tags: tags?.length ? tags : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json(rows);
  })
  .get("/:id", async (c) => c.json(await getReferenceDoc(c.req.param("id"))))
  .get("/", async (c) => {
    const tags = csv(c.req.query("tags"));
    const rows = await listReferenceDocs({
      status: c.req.query("status"),
      productId: c.req.query("product_id"),
      teamId: c.req.query("team_id"),
      tags: tags?.length ? tags : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json(rows);
  });
