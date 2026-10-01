import { z } from "zod";
import type { FlowActionCategory, FlowActionInfo } from "@tachy/contract";
import type { ScopeContext } from "../config/scoped";
import { badInput } from "../infra/errors";
import type { FlowSubject } from "./subject";

export interface FlowActionContext {
  flowId: string;
  flowRunId: string;
  /** Whose credentials the step acts with: the flow's owner. */
  scope: ScopeContext;
  userId: string | null;
  /** The item the run is about; null for a run with no item. */
  item: FlowSubject | null;
  signal: AbortSignal;
  log(message: string, fields?: Record<string, unknown>): void;
  /** Queues a job as a child of the run. */
  enqueue(kind: string, params: unknown): Promise<string | null>;
}

export interface FlowAction<P extends z.ZodObject = z.ZodObject> {
  key: string;
  title: string;
  description?: string;
  category: FlowActionCategory;
  /** The source type it acts on; absent when it acts on tachy itself. */
  source?: string;
  /** Changes something outside the run; a dry run reports it instead. */
  writes: boolean;
  params: P;
  output: z.ZodType;
  run(ctx: FlowActionContext, params: z.output<P>): Promise<unknown>;
}

const actions = new Map<string, FlowAction>();

/**
 * An action is code in a pull request, like a job kind; the editor only
 * chains what is registered. A dynamic param names where its choices come
 * from with `.meta({ "x-options": key })` (see ./options).
 */
export function defineFlowAction<P extends z.ZodObject>(
  action: FlowAction<P>,
): FlowAction<P> {
  actions.set(action.key, action as unknown as FlowAction);
  return action;
}

export function getFlowAction(key: string): FlowAction {
  const a = actions.get(key);
  if (!a) throw badInput(`unknown flow action '${key}'`);
  return a;
}

export const hasFlowAction = (key: string) => actions.has(key);

export function describeFlowActions(): FlowActionInfo[] {
  return [...actions.values()]
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
    )
    .map((a) => ({
      key: a.key,
      title: a.title,
      description: a.description ?? null,
      category: a.category,
      source: a.source ?? null,
      writes: a.writes,
      params_schema: z.toJSONSchema(a.params, { io: "input" }) as Record<
        string,
        unknown
      >,
      output_schema: z.toJSONSchema(a.output, { io: "output" }) as Record<
        string,
        unknown
      >,
    }));
}
