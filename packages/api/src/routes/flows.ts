import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { badInput } from "@tachy/core/infra";
import {
  createFlow,
  deleteFlow,
  flowActionCatalog,
  flowScope,
  getFlow,
  getFlowRun,
  listFlowRuns,
  listFlows,
  listOptions,
  updateFlow,
} from "@tachy/core/flows";
import { enqueueRun } from "@tachy/core/jobs";
import { getTeamIdBySlug } from "@tachy/core/catalog";
import { userTeams } from "@tachy/core/access";
import {
  assertAnyTeamAdminApi,
  assertScopeEditor,
  callerScope,
  callerUserId,
  isAdminIdentity,
  requireCaller,
} from "../authz";

const flowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** A team's slug; null makes a global flow, which only app admins edit. */
  team: z.string().nullable(),
  enabled: z.boolean().default(false),
  graph: z.unknown(),
});

const runSchema = z.object({
  work_item_id: z.string().uuid().optional(),
  trigger_id: z.string().optional(),
  dry_run: z.boolean().default(true),
});

async function input(c: Context, body: z.infer<typeof flowSchema>) {
  const team_id = body.team ? await getTeamIdBySlug(body.team) : null;
  await assertScopeEditor(c, { teamId: team_id });
  return {
    name: body.name,
    team_id,
    enabled: body.enabled,
    graph: body.graph,
  };
}

/**
 * Flows are edited by the admins of the team they belong to. The action
 * library and the option lists behind its pickers are read by anyone who
 * could build one.
 */
export const flows = new Hono()
  .get("/", async (c) => {
    if (isAdminIdentity(c)) return c.json(await listFlows());
    const teams = await userTeams(await requireCaller(c));
    return c.json(await listFlows(teams.map((t) => t.team_id)));
  })

  .get("/actions", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(flowActionCatalog());
  })

  /** Query params are the sibling values the list depends on. */
  .get("/options/:key", async (c) => {
    await assertAnyTeamAdminApi(c);
    return c.json(
      await listOptions(c.req.param("key"), {
        scope: await callerScope(c),
        params: c.req.query(),
      }),
    );
  })

  .get("/runs/:runId", async (c) => {
    const run = await getFlowRun(c.req.param("runId"));
    await assertScopeEditor(c, await flowScope(run.flow_id));
    return c.json(run);
  })

  .post("/", zValidator("json", flowSchema), async (c) => {
    const body = await input(c, c.req.valid("json"));
    return c.json(await createFlow(body, await callerUserId(c)), 201);
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await flowScope(id));
    return c.json(await getFlow(id));
  })

  .put("/:id", zValidator("json", flowSchema), async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await flowScope(id));
    const body = await input(c, c.req.valid("json"));
    return c.json(await updateFlow(id, body, await callerUserId(c)));
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await flowScope(id));
    await deleteFlow(id, await callerUserId(c));
    return c.body(null, 204);
  })

  .get("/:id/runs", async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await flowScope(id));
    return c.json(await listFlowRuns(id));
  })

  /** Dry by default: trying a flow on a ticket should not post on it. */
  .post("/:id/run", zValidator("json", runSchema), async (c) => {
    const id = c.req.param("id");
    await assertScopeEditor(c, await flowScope(id));
    const p = c.req.valid("json");
    const flow = await getFlow(id);
    if (p.trigger_id && !flow.graph.triggers.some((t) => t.id === p.trigger_id))
      throw badInput(`the flow has no trigger '${p.trigger_id}'`);
    const runId = await enqueueRun({
      kind: "flow.run",
      params: {
        flow_id: id,
        trigger_id: p.trigger_id,
        work_item_id: p.work_item_id,
        dry_run: p.dry_run,
      },
      trigger: "manual",
      requestedBy: await callerUserId(c),
    });
    if (!runId)
      throw badInput("this flow is already running on that item; wait for it");
    return c.json({ job_run_id: runId }, 202);
  });
