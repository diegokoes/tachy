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
  const i = steps.findIndex((s) => s.id === id);
  if (i >= 0) return { list: steps, index: i };
  for (const s of steps)
    if (s.kind === "if") {
      const hit = locate(s.then, id) ?? locate(s.else, id);
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
  const g = clone(graph);
  if ("after" in slot) {
    const at = locate(g.steps, slot.after);
    if (!at) return g;
    const prev = at.list[at.index];
    if (prev.kind === "if") prev.then.push(step);
    else {
      /* An if placed mid-list takes the steps after it into its then branch,
         so the list still ends at the if. */
      if (step.kind === "if") step.then = at.list.splice(at.index + 1);
      at.list.splice(at.index + 1, 0, step);
    }
    return g;
  }
  if (slot.list === "root") {
    const last = g.steps.at(-1);
    if (last?.kind === "if") last.then.push(step);
    else g.steps.push(step);
    return g;
  }
  const owner = findStep(g.steps, slot.of);
  if (owner?.kind === "if") {
    const list = owner[slot.list];
    const last = list.at(-1);
    if (last?.kind === "if") last.then.push(step);
    else list.push(step);
  }
  return g;
}

/** Removes a step; an if goes with both its branches. */
export function removeStep(graph: FlowGraph, id: string): FlowGraph {
  const g = clone(graph);
  const at = locate(g.steps, id);
  if (at) at.list.splice(at.index, 1);
  return g;
}

export function replaceStep(graph: FlowGraph, step: FlowStep): FlowGraph {
  const g = clone(graph);
  const at = locate(g.steps, step.id);
  if (at) at.list[at.index] = step;
  return g;
}

export function replaceTrigger(
  graph: FlowGraph,
  trigger: FlowTrigger,
): FlowGraph {
  const g = clone(graph);
  g.triggers = g.triggers.map((t) => (t.id === trigger.id ? trigger : t));
  return g;
}

/** The steps a run passes through before reaching `id`, nearest last. */
export function stepsBefore(steps: FlowStep[], id: string): FlowStep[] {
  const out: FlowStep[] = [];
  const walk = (list: FlowStep[]): boolean => {
    for (const s of list) {
      if (s.id === id) return true;
      out.push(s);
      if (s.kind === "if") {
        const mark = out.length;
        if (walk(s.then)) return true;
        out.length = mark;
        if (walk(s.else)) return true;
        out.length = mark;
      }
    }
    return false;
  };
  walk(steps);
  return out;
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
export function describeCondition(c: Condition): string {
  if ("all" in c)
    return c.all.length === 1
      ? describeCondition(c.all[0])
      : `all of ${c.all.length}`;
  if ("any" in c)
    return c.any.length === 1
      ? describeCondition(c.any[0])
      : `any of ${c.any.length}`;
  if ("not" in c) return `not ${describeCondition(c.not)}`;
  const field = c.field.replace(/^item\.(raw\.)?/, "");
  if (c.op === "exists") return `${field} is set`;
  const v = Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? "");
  return `${field} ${OPS[c.op] ?? c.op} ${v || "…"}`;
}

export type Selection =
  { kind: "trigger"; id: string } | { kind: "step"; id: string };

export const TRIGGER_TITLES: Record<FlowTrigger["kind"], string> = {
  "item.synced": "item synced",
  manual: "run by hand",
  schedule: "on schedule",
};

export function describeTrigger(t: FlowTrigger): string {
  if (t.kind === "item.synced")
    return [t.params.connection, t.where ? describeCondition(t.where) : null]
      .filter(Boolean)
      .join(" · ");
  if (t.kind === "schedule")
    return [t.params.cron, t.params.connection].filter(Boolean).join(" · ");
  return "test runs, the API";
}

/** What the palette hands back: a control step or an action from the library. */
export type Pick =
  | { kind: "if" }
  | { kind: "filter" }
  | { kind: "action"; action: FlowActionInfo };
