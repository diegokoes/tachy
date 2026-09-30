import { Cron } from "croner";
import { z } from "zod";
import {
  CONDITION_OPS,
  FLOW_TRIGGER_KINDS,
  type Condition,
  type FlowGraph,
  type FlowStep,
} from "@tachy/contract";
import { badInput } from "../infra/errors";
import { flowAction, hasAction } from "./catalog";

const id = z
  .string()
  .regex(/^[\w-]{1,40}$/, "ids are letters, digits, _ and -");

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(condition).max(50) }).strict(),
    z.object({ any: z.array(condition).max(50) }).strict(),
    z.object({ not: condition }).strict(),
    z
      .object({
        field: z.string().min(1),
        op: z.enum(CONDITION_OPS),
        value: z.unknown().optional(),
      })
      .strict(),
  ]),
);

const step: z.ZodType<FlowStep> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        id,
        kind: z.literal("action"),
        action: z.string().min(1),
        params: z.record(z.string(), z.unknown()).default({}),
        label: z.string().max(80).optional(),
      })
      .strict(),
    z
      .object({
        id,
        kind: z.literal("if"),
        when: condition,
        then: z.array(step).max(100).default([]),
        else: z.array(step).max(100).default([]),
        label: z.string().max(80).optional(),
      })
      .strict(),
    z
      .object({
        id,
        kind: z.literal("filter"),
        when: condition,
        label: z.string().max(80).optional(),
      })
      .strict(),
  ]),
);

export const flowGraphSchema = z
  .object({
    triggers: z
      .array(
        z
          .object({
            id,
            kind: z.enum(FLOW_TRIGGER_KINDS),
            params: z.record(z.string(), z.unknown()).default({}),
            where: condition.optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    steps: z.array(step).max(100).default([]),
  })
  .strict();

const TEMPLATED = /\{\{[^}]+\}\}/;

/** Whether the value at `path` in `params` is a template, filled at run time. */
function templatedAt(params: unknown, path: PropertyKey[]): boolean {
  let at: unknown = params;
  for (const k of path) {
    if (at == null || typeof at !== "object") return false;
    at = (at as Record<PropertyKey, unknown>)[k];
  }
  return typeof at === "string" && TEMPLATED.test(at);
}

function* walk(steps: FlowStep[]): Generator<FlowStep> {
  for (const s of steps) {
    yield s;
    if (s.kind === "if") {
      yield* walk(s.then);
      yield* walk(s.else);
    }
  }
}

function checkLists(steps: FlowStep[], where: string) {
  steps.forEach((s, i) => {
    if (s.kind === "if" && i < steps.length - 1)
      throw badInput(
        `${where}: '${s.id}' is an if, so it has to end its list; put what follows inside its branches`,
      );
    if (s.kind === "if") {
      checkLists(s.then, `${s.id} › then`);
      checkLists(s.else, `${s.id} › else`);
    }
  });
}

/**
 * Everything a save must pass, so a flow that reaches a worker can only fail
 * on what it meets at run time. Params are checked against their action with
 * templates let through: `{{steps.x.count}}` is a number only once x has run.
 */
export function validateGraph(input: unknown): FlowGraph {
  const parsed = flowGraphSchema.safeParse(input);
  if (!parsed.success)
    throw badInput(
      `flow: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`,
    );
  const graph = parsed.data as FlowGraph;

  const ids = new Set<string>();
  for (const t of graph.triggers) {
    if (ids.has(t.id)) throw badInput(`id '${t.id}' is used twice`);
    ids.add(t.id);
    if (t.kind === "item.synced" && !t.params.connection)
      throw badInput(`trigger '${t.id}' needs a connection`);
    if (t.kind === "schedule") {
      const cron = String(t.params.cron ?? "");
      const tz = String(t.params.timezone ?? "UTC");
      try {
        new Cron(cron, { timezone: tz }).nextRun();
      } catch (err) {
        throw badInput(`trigger '${t.id}': schedule '${cron}': ${String(err)}`);
      }
    }
  }

  checkLists(graph.steps, "flow");
  for (const s of walk(graph.steps)) {
    if (ids.has(s.id)) throw badInput(`id '${s.id}' is used twice`);
    ids.add(s.id);
    if (s.kind !== "action") continue;
    if (!hasAction(s.action))
      throw badInput(`step '${s.id}': unknown action '${s.action}'`);
    const res = flowAction(s.action).params.safeParse(s.params);
    if (res.success) continue;
    const real = res.error.issues.filter((i) => !templatedAt(s.params, i.path));
    if (real.length)
      throw badInput(
        `step '${s.id}': ${real.map((i) => `${i.path.join(".") || "(params)"} ${i.message}`).join("; ")}`,
      );
  }
  return graph;
}

/** The steps of a graph in the order a run would first reach them. */
export const flowSteps = (graph: FlowGraph) => [...walk(graph.steps)];
