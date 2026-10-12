import { Hono } from "hono";
import { validate } from "../validation";
import { z } from "zod";
import { AUDIT_ACTIONS, MAX_PAGE } from "@tachy/core";
import { listAudit } from "@tachy/core/audit";
import { requireAdmin } from "../auth";

const pageQuery = z.object({
  before: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
});

/** The audit trail, for app admins: it names who signs in from where. */
export const auditTrail = new Hono()
  .use("*", requireAdmin)
  .get("/", validate("query", pageQuery), async (c) =>
    c.json(await listAudit(c.req.valid("query"))),
  );
