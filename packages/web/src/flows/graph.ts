import type {
  Condition,
  FlowActionInfo,
  FlowGraph,
  FlowStep,
  FlowTrigger,
} from "@tachy/contract";

/** Where a new step goes: the end of a list, or after a step in its list. */
export type Slot =
  { list: "root" } | { list: "then" | "else"; of: string } | { after: string };

export const emptyGraph = (): FlowGraph => ({ triggers: [], steps: [] });

/** A fresh id not yet used in the graph: `search`, `search-2`, … */
export function freshId(graph: FlowGraph, base: string): string {
  const used = new Set([
    ...graph.triggers.map((t) => t.id),
    ...allSteps(graph.steps).map((s) => s.id),
  ]);
  const stem =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "step";
  if (!used.has(stem)) return stem;
  for (let i = 2; ; i++) if (!used.has(`${stem}-${i}`)) return `${stem}-${i}`;
}

export function allSteps(steps: FlowStep[]): FlowStep[] {
  return steps.flatMap((s) =>
    s.kind === "if" ? [s, ...allSteps(s.then), ...allSteps(s.else)] : [s],
  );
}

export function findStep(steps: FlowStep[], id: string): FlowStep | null {
  return allSteps(steps).find((s) => s.id === id) ?? null;
}

/** The list a step sits in, and its index there. */
function locate(
  steps: FlowStep[],
  id: string,
): { list: FlowStep[]; index: number } | null {
  const index = steps.findIndex((s) => s.id === id);
  if (index >= 0) return { list: steps, index: index };
  for (const step of steps)
    if (step.kind === "if") {
      const hit = locate(step.then, id) ?? locate(step.else, id);
      if (hit) return hit;
    }
  return null;
}

const clone = (g: FlowGraph): FlowGraph => JSON.parse(JSON.stringify(g));

/**
 * Puts a step at a slot. After an `if` there is nowhere to go, since an if
 * ends its list; a step asked for there goes to the end of its then branch.
 */
export function insertStep(
  graph: FlowGraph,
  slot: Slot,
  step: FlowStep,
): FlowGraph {
  const copy = clone(graph);
  if ("after" in slot) {
    const at = locate(copy.steps, slot.after);
    if (!at) return copy;
    const prev = at.list[at.index];
    if (prev.kind === "if") prev.then.push(step);
    else {
      // An if placed mid-list takes the steps after it into its then branch, so
      // the list still ends at the if.
      if (step.kind === "if") step.then = at.list.splice(at.index + 1);
      at.list.splice(at.index + 1, 0, step);
    }
    return copy;
  }
  if (slot.list === "root") {
    const last = copy.steps.at(-1);
    if (last?.kind === "if") last.then.push(step);
    else copy.steps.push(step);
    return copy;
  }
  const owner = findStep(copy.steps, slot.of);
  if (owner?.kind === "if") {
    const list = owner[slot.list];
    const last = list.at(-1);
    if (last?.kind === "if") last.then.push(step);
    else list.push(step);
  }
  return copy;
}

/** Removes a step; an if goes with both its branches. */
export function removeStep(graph: FlowGraph, id: string): FlowGraph {
  const copy = clone(graph);
  const at = locate(copy.steps, id);
  if (at) at.list.splice(at.index, 1);
  return copy;
}

export function replaceStep(graph: FlowGraph, step: FlowStep): FlowGraph {
  const copy = clone(graph);
  const at = locate(copy.steps, step.id);
  if (at) at.list[at.index] = step;
  return copy;
}

export function replaceTrigger(
  graph: FlowGraph,
  trigger: FlowTrigger,
): FlowGraph {
  const copy = clone(graph);
  copy.triggers = copy.triggers.map((t) => (t.id === trigger.id ? trigger : t));
  return copy;
}

/** The steps a run passes through before reaching `id`, nearest last. */
export function stepsBefore(steps: FlowStep[], id: string): FlowStep[] {
  const before: FlowStep[] = [];
  const walk = (list: FlowStep[]): boolean => {
    for (const step of list) {
      if (step.id === id) return true;
      before.push(step);
      if (step.kind === "if") {
        const mark = before.length;
        if (walk(step.then)) return true;
        before.length = mark;
        if (walk(step.else)) return true;
        before.length = mark;
      }
    }
    return false;
  };
  walk(steps);
  return before;
}

export const newCondition = (): Condition => ({
  field: "item.status",
  op: "eq",
  value: "",
});

const OPS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  in: "is one of",
  contains: "contains",
  matches: "matches",
  exists: "is set",
  gt: ">",
  lt: "<",
};

/** A condition in a few words, for a node's second line. */
export function describeCondition(condition: Condition): string {
  if ("all" in condition)
    return condition.all.length === 1
      ? describeCondition(condition.all[0])
      : `all of ${condition.all.length}`;
  if ("any" in condition)
    return condition.any.length === 1
      ? describeCondition(condition.any[0])
      : `any of ${condition.any.length}`;
  if ("not" in condition) return `not ${describeCondition(condition.not)}`;
  const field = condition.field.replace(/^item\.(raw\.)?/, "");
  if (condition.op === "exists") return `${field} is set`;
  const shown = Array.isArray(condition.value)
    ? condition.value.join(", ")
    : String(condition.value ?? "");
  return `${field} ${OPS[condition.op] ?? condition.op} ${shown || "…"}`;
}

export type Selection =
  { kind: "trigger"; id: string } | { kind: "step"; id: string };

export const TRIGGER_TITLES: Record<FlowTrigger["kind"], string> = {
  "item.synced": "item synced",
  manual: "run by hand",
  schedule: "on schedule",
};

export function describeTrigger(trigger: FlowTrigger): string {
  if (trigger.kind === "item.synced")
    return [
      trigger.params.connection,
      trigger.where ? describeCondition(trigger.where) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  if (trigger.kind === "schedule")
    return [trigger.params.cron, trigger.params.connection]
      .filter(Boolean)
      .join(" · ");
  return "test runs, the API";
}

/** What the palette hands back: a control step or an action from the library. */
export type Pick =
  | { kind: "if" }
  | { kind: "filter" }
  | { kind: "action"; action: FlowActionInfo };
