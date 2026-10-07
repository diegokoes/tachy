import { z } from "zod";
import {
  evaluateCondition,
  interpolate,
  type Flow,
  type FlowRunStatus,
  type FlowStep,
  type FlowStepTrace,
} from "@tachy/contract";
import { userSoleTeamId } from "../access/users";
import type { ScopeContext } from "../config/scoped";
import { sql, jsonb } from "../infra/db";
import type { FlowAction, FlowActionContext } from "./actions";
import { flowAction } from "./catalog";
import { loadSubject, type FlowSubject } from "./subject";

/** Beyond this a step's stored input or output is cut: a whole thread can be long. */
const TRACE_CHARS = 20_000;

function clip(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  return json.length <= TRACE_CHARS
    ? value
    : { clipped: true, preview: json.slice(0, TRACE_CHARS) };
}

export async function ownerScope(userId: string | null): Promise<ScopeContext> {
  if (!userId) return {};
  return { userId, teamId: (await userSoleTeamId(userId)) ?? undefined };
}

class Stopped extends Error {}

const defaults = new WeakMap<FlowAction, Record<string, unknown>>();

/**
 * An action's param defaults, filled in before interpolation: a default can be
 * a template itself, as a search's query defaults to `{{item.title}}`, and
 * Zod only applies defaults after, when there is nothing left to fill.
 */
function defaultsOf(action: FlowAction): Record<string, unknown> {
  let known = defaults.get(action);
  if (!known) {
    const schema = z.toJSONSchema(action.params, { io: "input" }) as {
      properties?: Record<string, { default?: unknown }>;
    };
    known = Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(([, p]) => p.default !== undefined)
        .map(([k, p]) => [k, p.default]),
    );
    defaults.set(action, known);
  }
  return known;
}

export interface RunFlowOptions {
  flow: Flow;
  triggerId: string | null;
  workItemId: string | null;
  dryRun: boolean;
  jobRunId: string | null;
  signal: AbortSignal;
  log(message: string, fields?: Record<string, unknown>): void;
  enqueue(kind: string, params: unknown): Promise<string | null>;
}

/**
 * Walks the flow's steps over one item. Each step reads what earlier ones
 * returned as `steps.<id>`; a write in a dry run records what it would have
 * done and passes that on. The trace is saved after every step, so a run can
 * be watched while it goes. A failed step fails the run and throws, so the job
 * fails with it.
 */
export async function runFlow(opts: RunFlowOptions): Promise<{
  flowRunId: string;
  status: FlowRunStatus;
}> {
  const [row] = await sql`
    insert into flow_runs (flow_id, job_run_id, trigger_id, work_item_id, dry_run)
    values (${opts.flow.id}, ${opts.jobRunId}, ${opts.triggerId}, ${opts.workItemId}, ${opts.dryRun})
    returning id
  `;
  const flowRunId = row.id as string;
  const trace: FlowStepTrace[] = [];
  const save = (status: FlowRunStatus, error: string | null = null) => sql`
    update flow_runs set steps = ${jsonb(trace)}, status = ${status}, error = ${error},
      finished_at = ${status === "running" ? null : sql`now()`}
    where id = ${flowRunId}
  `;

  let item: FlowSubject | null = null;
  const context: {
    item: FlowSubject | null;
    steps: Record<string, unknown>;
    flow: { id: string; name: string };
    trigger: string | null;
  } = {
    item: null,
    steps: {},
    flow: { id: opts.flow.id, name: opts.flow.name },
    trigger: opts.triggerId,
  };

  const ctx: FlowActionContext = {
    flowId: opts.flow.id,
    flowRunId,
    scope: await ownerScope(opts.flow.run_as_user_id),
    userId: opts.flow.run_as_user_id,
    item: null,
    signal: opts.signal,
    log: opts.log,
    enqueue: opts.enqueue,
  };

  async function runStep(step: FlowStep) {
    opts.signal.throwIfAborted();
    const started = Date.now();
    const done = async (
      entry: Omit<FlowStepTrace, "step_id" | "kind" | "ms">,
    ) => {
      trace.push({
        step_id: step.id,
        kind: step.kind,
        ms: Date.now() - started,
        ...entry,
      });
      await save("running");
    };

    if (step.kind === "filter") {
      const held = evaluateCondition(step.when, context);
      await done({ status: "ok", held });
      if (!held) throw new Stopped();
      return;
    }
    if (step.kind === "if") {
      const held = evaluateCondition(step.when, context);
      await done({ status: "ok", held });
      for (const next of held ? step.then : step.else) await runStep(next);
      return;
    }

    const action = flowAction(step.action);
    const input = interpolate(
      { ...defaultsOf(action), ...step.params },
      context,
    );
    const parsed = action.params.safeParse(input);
    if (!parsed.success) {
      const error = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(params)"} ${i.message}`)
        .join("; ");
      await done({ status: "failed", input: clip(input), error });
      throw new Error(`step '${step.id}': ${error}`);
    }
    if (opts.dryRun && action.writes) {
      const output = { would: parsed.data };
      context.steps[step.id] = output;
      await done({ status: "dry", input: clip(parsed.data), output });
      return;
    }
    try {
      const output = await action.run(ctx, parsed.data);
      context.steps[step.id] = output;
      await done({
        status: "ok",
        input: clip(parsed.data),
        output: clip(output),
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await done({ status: "failed", input: clip(parsed.data), error });
      throw new Error(`step '${step.id}': ${error}`);
    }
  }

  try {
    if (opts.workItemId) {
      item = await loadSubject(opts.workItemId);
      context.item = item;
      ctx.item = item;
    }
    for (const step of opts.flow.graph.steps) await runStep(step);
    await save("succeeded");
    return { flowRunId, status: "succeeded" };
  } catch (e) {
    if (e instanceof Stopped) {
      await save("stopped");
      return { flowRunId, status: "stopped" };
    }
    await save("failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Flow runs keep 90 days, failed ones 180, as job runs do. */
export async function sweepFlowRuns(): Promise<number> {
  const rows = await sql`
    delete from flow_runs
    where status <> 'running'
      and coalesce(finished_at, started_at)
          < now() - case when status = 'failed' then interval '180 days' else interval '90 days' end
    returning id
  `;
  return rows.length;
}
