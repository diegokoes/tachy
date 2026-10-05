import type { Flow, FlowGraph, FlowRun } from "@tachy/contract";
import type { EntryScope } from "../access/permissions";
import { orgTimezone } from "../config/settings";
import { sql, jsonb } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import {
  createJobDefinition,
  deleteJobDefinition,
  updateJobDefinition,
} from "../jobs/definitions";
import { validateGraph } from "./graph";

export interface FlowInput {
  name: string;
  team_id: string | null;
  enabled: boolean;
  graph: unknown;
}

const SELECT = sql`
  select f.id, f.name, f.team_id, t.slug as team_slug, f.enabled, f.graph,
         f.run_as_user_id, u.email as run_as_email, f.created_at, f.updated_at
  from flows f
  left join teams t on t.id = f.team_id
  left join users u on u.id = f.run_as_user_id
`;

/** Every flow, or only those of the given teams (global ones stay admin's). */
export async function listFlows(teamIds?: string[] | null): Promise<Flow[]> {
  return (await sql`
    ${SELECT}
    ${teamIds ? sql`where f.team_id = any(${teamIds})` : sql``}
    order by t.slug nulls first, lower(f.name)
  `) as never;
}

export async function getFlow(id: string): Promise<Flow> {
  const [row] = await sql`${SELECT} where f.id = ${id}`;
  if (!row) throw notFound(`flow ${id} not found`);
  return row as never;
}

/** Who may edit a flow: its team's admins, or app admins for a global one. */
export async function flowScope(id: string): Promise<EntryScope> {
  const [row] = await sql`select team_id from flows where id = ${id}`;
  if (!row) throw notFound(`flow ${id} not found`);
  return { productId: null, teamId: row.team_id };
}

const uniqueName = (e: unknown) =>
  e instanceof Error && /flows_name_idx/.test(e.message)
    ? badInput("a flow with that name already exists here")
    : e;

/** Saving makes the saver the flow's owner: its steps use their credentials. */
export async function createFlow(input: FlowInput, by: string | null) {
  const graph = validateGraph(input.graph);
  let row;
  try {
    [row] = await sql`
      insert into flows (name, team_id, enabled, graph, run_as_user_id, created_by)
      values (${input.name}, ${input.team_id}, ${input.enabled}, ${jsonb(graph)}, ${by}, ${by})
      returning id
    `;
  } catch (e) {
    throw uniqueName(e);
  }
  await syncSchedules(row.id, by);
  return getFlow(row.id);
}

export async function updateFlow(
  id: string,
  input: FlowInput,
  by: string | null,
): Promise<Flow> {
  const graph = validateGraph(input.graph);
  let row;
  try {
    [row] = await sql`
      update flows set name = ${input.name}, team_id = ${input.team_id},
        enabled = ${input.enabled}, graph = ${jsonb(graph)}, run_as_user_id = ${by}
      where id = ${id}
      returning id
    `;
  } catch (e) {
    throw uniqueName(e);
  }
  if (!row) throw notFound(`flow ${id} not found`);
  await syncSchedules(id, by);
  return getFlow(id);
}

export async function deleteFlow(id: string, by: string | null) {
  for (const d of await scheduleDefinitions(id))
    await deleteJobDefinition(d.id, by);
  await sql`delete from flows where id = ${id}`;
}

async function scheduleDefinitions(flowId: string) {
  return (await sql`
    select id, params->>'trigger_id' as trigger_id from job_definitions
    where kind = 'flow.run' and params->>'flow_id' = ${flowId}
  `) as unknown as { id: string; trigger_id: string }[];
}

/**
 * A schedule trigger is a job definition, so the scheduler fires it and the
 * workers page shows it beside every other schedule. Kept in step with the
 * flow on each save; a paused flow pauses its definitions.
 */
async function syncSchedules(flowId: string, by: string | null) {
  const flow = await getFlow(flowId);
  const wanted = new Map(
    (flow.graph as FlowGraph).triggers
      .filter((t) => t.kind === "schedule")
      .map((t) => [t.id, t]),
  );
  const timezone = await orgTimezone();
  for (const d of await scheduleDefinitions(flowId)) {
    const t = wanted.get(d.trigger_id);
    if (!t) {
      await deleteJobDefinition(d.id, by);
      continue;
    }
    wanted.delete(d.trigger_id);
    await updateJobDefinition(
      d.id,
      definitionOf(flow, t.id, t.params, timezone),
      by,
    );
  }
  for (const t of wanted.values())
    await createJobDefinition(definitionOf(flow, t.id, t.params, timezone), by);
}

function definitionOf(
  flow: Flow,
  triggerId: string,
  params: Record<string, unknown>,
  timezone: string,
) {
  return {
    kind: "flow.run",
    name: `${flow.name} · ${triggerId} (flow ${flow.id.slice(0, 8)})`,
    params: { flow_id: flow.id, trigger_id: triggerId },
    enabled: flow.enabled,
    schedule: String(params.cron),
    timezone: String(params.timezone || timezone),
    notify: "never" as const,
  };
}

export async function listFlowRuns(
  flowId: string,
  limit = 50,
): Promise<FlowRun[]> {
  return (await sql`
    select * from flow_runs where flow_id = ${flowId}
    order by started_at desc limit ${limit}
  `) as never;
}

export async function getFlowRun(id: string): Promise<FlowRun> {
  const [row] = await sql`select * from flow_runs where id = ${id}`;
  if (!row) throw notFound(`flow run ${id} not found`);
  return row as never;
}
