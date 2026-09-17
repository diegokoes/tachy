import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  JOB_CLASS_CHAT_SLOTS,
  JOB_STATUSES,
  badInput,
  cancelRun,
  createJobDefinition,
  deleteJobDefinition,
  describeJobKinds,
  effectiveSettings,
  enqueueRun,
  getJobDefinition,
  getJobRun,
  jobDefinitionInput,
  listJobDefinitionChanges,
  listJobDefinitions,
  listJobRuns,
  previewSchedule,
  sql,
  updateJobDefinition,
} from "@tachy/core";
import { requireAdmin } from "../auth";
import { callerUserId } from "../authz";

const previewSchema = z.object({
  schedule: z.string().min(1),
  timezone: z.string().default("UTC"),
});

/**
 * Global admins configure jobs: definitions of kinds that exist in code. Nothing
 * here uploads or runs code; `params` is validated against the kind's schema.
 */
export const jobs = new Hono()
  .use("*", requireAdmin)

  .get("/kinds", async (c) => {
    const settings = await effectiveSettings();
    return c.json({
      kinds: describeJobKinds(),
      chat_slot_cap: settings.agent_slot_cap.value,
      class_chat_slots: JOB_CLASS_CHAT_SLOTS,
    });
  })

  .post("/schedule-preview", zValidator("json", previewSchema), async (c) => {
    const { schedule, timezone } = c.req.valid("json");
    try {
      return c.json({ next: previewSchedule(schedule, timezone) });
    } catch (err) {
      throw badInput(`schedule: ${(err as Error).message}`);
    }
  })

  .get("/definitions", async (c) => {
    const defs = await listJobDefinitions();
    const last = await sql`
      select distinct on (definition_id) definition_id, id, status, created_at, finished_at, error
      from job_runs where definition_id is not null
      order by definition_id, created_at desc
    `;
    const byDef = new Map(last.map((r) => [r.definition_id as string, r]));
    return c.json(
      defs.map((d) => {
        let next: string | null = null;
        if (d.enabled && d.schedule)
          try {
            next = previewSchedule(d.schedule, d.timezone, 1)[0] ?? null;
          } catch {}
        return { ...d, next_run: next, last_run: byDef.get(d.id) ?? null };
      }),
    );
  })

  .post("/definitions", zValidator("json", jobDefinitionInput), async (c) =>
    c.json(
      await createJobDefinition(c.req.valid("json"), await callerUserId(c)),
      201,
    ),
  )

  .patch(
    "/definitions/:id",
    zValidator("json", jobDefinitionInput.partial()),
    async (c) =>
      c.json(
        await updateJobDefinition(
          c.req.param("id"),
          c.req.valid("json"),
          await callerUserId(c),
        ),
      ),
  )

  .delete("/definitions/:id", async (c) => {
    await deleteJobDefinition(c.req.param("id"), await callerUserId(c));
    return c.json({ ok: true });
  })

  .get("/definitions/:id/changes", async (c) =>
    c.json(await listJobDefinitionChanges(c.req.param("id"))),
  )

  .post("/definitions/:id/run", async (c) => {
    const d = await getJobDefinition(c.req.param("id"));
    const id = await enqueueRun({
      kind: d.kind,
      params: d.params,
      trigger: "manual",
      definitionId: d.id,
      requestedBy: await callerUserId(c),
    });
    return c.json({ run_id: id }, 202);
  })

  .get(
    "/runs",
    zValidator(
      "query",
      z.object({
        definition_id: z.string().uuid().optional(),
        status: z.enum(JOB_STATUSES).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }),
    ),
    async (c) => {
      const q = c.req.valid("query");
      return c.json(
        await listJobRuns({
          definitionId: q.definition_id,
          status: q.status,
          limit: q.limit,
        }),
      );
    },
  )

  .post(
    "/runs",
    zValidator(
      "json",
      z.object({
        kind: z.string().min(1),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    ),
    async (c) => {
      const { kind, params } = c.req.valid("json");
      const id = await enqueueRun({
        kind,
        params,
        trigger: "manual",
        requestedBy: await callerUserId(c),
      });
      return c.json({ run_id: id }, 202);
    },
  )

  .get("/runs/:id", async (c) => c.json(await getJobRun(c.req.param("id"))))

  .post("/runs/:id/cancel", async (c) =>
    c.json(await cancelRun(c.req.param("id"))),
  );
