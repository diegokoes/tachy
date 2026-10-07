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
  for (const key of path) {
    if (at == null || typeof at !== "object") return false;
    at = (at as Record<PropertyKey, unknown>)[key];
  }
  return typeof at === "string" && TEMPLATED.test(at);
}

function* walk(steps: FlowStep[]): Generator<FlowStep> {
  for (const step of steps) {
    yield step;
    if (step.kind === "if") {
      yield* walk(step.then);
      yield* walk(step.else);
    }
  }
}

function checkLists(steps: FlowStep[], where: string) {
  steps.forEach((step, index) => {
    if (step.kind === "if" && index < steps.length - 1)
      throw badInput(
        `${where}: '${step.id}' is an if, so it has to end its list; put what follows inside its branches`,
      );
    if (step.kind === "if") {
      checkLists(step.then, `${step.id} › then`);
      checkLists(step.else, `${step.id} › else`);
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
  for (const trigger of graph.triggers) {
    if (ids.has(trigger.id)) throw badInput(`id '${trigger.id}' is used twice`);
    ids.add(trigger.id);
    if (trigger.kind === "item.synced" && !trigger.params.connection)
      throw badInput(`trigger '${trigger.id}' needs a connection`);
    if (trigger.kind === "schedule") {
      const cron = String(trigger.params.cron ?? "");
      const timezone = String(trigger.params.timezone ?? "UTC");
      try {
        new Cron(cron, { timezone }).nextRun();
      } catch (err) {
        throw badInput(
          `trigger '${trigger.id}': schedule '${cron}': ${String(err)}`,
        );
      }
    }
  }

  checkLists(graph.steps, "flow");
  for (const step of walk(graph.steps)) {
    if (ids.has(step.id)) throw badInput(`id '${step.id}' is used twice`);
    ids.add(step.id);
    if (step.kind !== "action") continue;
    if (!hasAction(step.action))
      throw badInput(`step '${step.id}': unknown action '${step.action}'`);
    const parsed = flowAction(step.action).params.safeParse(step.params);
    if (parsed.success) continue;
    const real = parsed.error.issues.filter(
      (i) => !templatedAt(step.params, i.path),
    );
    if (real.length)
      throw badInput(
        `step '${step.id}': ${real.map((i) => `${i.path.join(".") || "(params)"} ${i.message}`).join("; ")}`,
      );
  }
  return graph;
}

/** The steps of a graph in the order a run would first reach them. */
export const flowSteps = (graph: FlowGraph) => [...walk(graph.steps)];
