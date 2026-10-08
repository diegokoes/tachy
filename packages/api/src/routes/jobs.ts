import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  JOB_CLASS_CHAT_SLOTS,
  JOB_QUEUES,
  JOB_QUEUE_NAMES,
  JOB_STATUSES,
  JOB_TRIGGERS,
} from "@tachy/core";
import { badInput, sql } from "@tachy/core/infra";
import {
  cancelRun,
  createJobDefinition,
  deleteJobDefinition,
  describeJobKinds,
  enqueueRun,
  getJobDefinition,
  getJobRun,
  jobCensus,
  jobLive,
  jobDefinitionInput,
  listJobDefinitionChanges,
  listJobDefinitions,
  listJobRuns,
  presentRun,
  previewSchedule,
  updateJobDefinition,
} from "@tachy/core/jobs";
import { effectiveSettings, orgTimezone } from "@tachy/core/config";
import { requireAdmin } from "../auth";
import { callerUserId } from "../authz";

/**
 * How far back the census looks. The overview and its detail view ask for
 * different spans.
 */
const periodQuery = z.object({
  days: z.coerce.number().int().min(7).max(90).optional(),
});

const previewSchema = z.object({
  schedule: z.string().min(1),
  timezone: z.string().optional(),
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
      timezone: settings.org_timezone.value,
      class_chat_slots: JOB_CLASS_CHAT_SLOTS,
      queues: JOB_QUEUES,
    });
  })

  .get("/census", zValidator("query", periodQuery), async (c) =>
    c.json(await jobCensus(c.req.valid("query").days ?? 14)),
  )

  .get("/live", async (c) => c.json(await jobLive()))

  .post("/schedule-preview", zValidator("json", previewSchema), async (c) => {
    const { schedule, timezone } = c.req.valid("json");
    try {
      return c.json({
        next: previewSchedule(schedule, timezone || (await orgTimezone())),
      });
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
      defs.map((definition) => {
        let next: string | null = null;
        if (definition.enabled && definition.schedule)
          try {
            next =
              previewSchedule(definition.schedule, definition.timezone, 1)[0] ??
              null;
          } catch {}
        return {
          ...definition,
          subject: presentRun(definition.kind, definition.params, null).subject,
          next_run: next,
          last_run: byDef.get(definition.id) ?? null,
        };
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
    const definition = await getJobDefinition(c.req.param("id"));
    const id = await enqueueRun({
      kind: definition.kind,
      params: definition.params,
      trigger: "manual",
      definitionId: definition.id,
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
        parent_id: z.string().uuid().optional(),
        status: z.enum(JOB_STATUSES).optional(),
        kind: z.string().min(1).optional(),
        queue: z.enum(JOB_QUEUE_NAMES as [string, ...string[]]).optional(),
        trigger: z.enum(JOB_TRIGGERS).optional(),
        active: z
          .enum(["true", "false"])
          .transform((v) => v === "true")
          .optional(),
        before: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query");
      return c.json(
        await listJobRuns({
          definitionId: query.definition_id,
          parentId: query.parent_id,
          status: query.status,
          kind: query.kind,
          queue: query.queue,
          trigger: query.trigger,
          active: query.active,
          before: query.before,
          limit: query.limit,
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
