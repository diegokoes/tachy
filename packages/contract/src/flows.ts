/**
 * How a team shapes one creation form, stored per registered project and item
 * type. Source-agnostic: fields are the source's own field ids, and a source
 * with no such form simply has no config.
 */

/**
 * "form" shows it even where the source's own form hides it; "fold" tucks it
 * into the collapsed section; "hidden" leaves it out, its default still sent.
 * With no entry, the source's own form decides.
 */
export type FieldShow = "form" | "fold" | "hidden";

/** A starting value the person can still change. */
export type FieldDefault = { value: unknown } | { macro: "@me" };

export interface FieldFormConfig {
  show?: FieldShow;
  default?: FieldDefault;
}

export interface TypeFormConfig {
  fields?: Record<string, FieldFormConfig>;
  /** Field ids in the order they are drawn; ones not listed keep their place after. */
  order?: string[];
  /** Appended to tachy's review checklist for this type. */
  guidance?: string;
}

export interface ComposeConfig {
  /** The types offered, in order. Absent: every type the source can create. */
  types?: string[];
  forms?: Record<string, TypeFormConfig>;
}

/** What the composer draws differently because of a team's config. */
export interface FormDisplay {
  show: Record<string, FieldShow>;
  order: string[];
}

export const FIELD_SHOWS: readonly FieldShow[] = ["form", "fold", "hidden"];

/* ---- complex flows ------------------------------------------------------- */

/**
 * A flow is triggers and a tree of steps. Each list of steps runs in order; an
 * `if` ends its list, so every path through a flow is a branch of one tree and
 * the editor can draw it as one.
 */
export const FLOW_TRIGGER_KINDS = [
  "item.synced",
  "manual",
  "schedule",
] as const;
export type FlowTriggerKind = (typeof FLOW_TRIGGER_KINDS)[number];

export const CONDITION_OPS = [
  "eq",
  "neq",
  "in",
  "contains",
  "matches",
  "exists",
  "gt",
  "lt",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { field: string; op: ConditionOp; value?: unknown };

export interface FlowTrigger {
  /** Stable within the flow; runs and schedules name the trigger by it. */
  id: string;
  kind: FlowTriggerKind;
  /**
   * item.synced: `{ connection, events: ("created"|"updated")[] }`.
   * schedule: `{ cron, timezone?, connection?, since_days?, max_items? }`,
   * once per matching item of the connection, or once with no item without one.
   */
  params: Record<string, unknown>;
  /** Checked against the item before a run is queued. */
  where?: Condition;
}

export interface FlowActionStep {
  id: string;
  kind: "action";
  action: string;
  /** Strings may carry `{{item.title}}` or `{{steps.<id>.<path>}}`. */
  params: Record<string, unknown>;
  label?: string;
}

export interface FlowIfStep {
  id: string;
  kind: "if";
  when: Condition;
  then: FlowStep[];
  else: FlowStep[];
  label?: string;
}

/** Ends the run, as stopped, when its condition does not hold. */
export interface FlowFilterStep {
  id: string;
  kind: "filter";
  when: Condition;
  label?: string;
}

export type FlowStep = FlowActionStep | FlowIfStep | FlowFilterStep;

export interface FlowGraph {
  triggers: FlowTrigger[];
  steps: FlowStep[];
}

export interface Flow {
  id: string;
  name: string;
  /** Null: a global flow, which only app admins edit. */
  team_id: string | null;
  team_slug: string | null;
  enabled: boolean;
  graph: FlowGraph;
  /** Whose credentials the flow's steps use: whoever saved it last. */
  run_as_user_id: string | null;
  run_as_email: string | null;
  created_at: string;
  updated_at: string;
}

/** The step menu's groups, in the order it lists them. */
export const FLOW_ACTION_CATEGORIES = [
  "control",
  "read",
  "search",
  "agent",
  "update",
  "create",
] as const;
export type FlowActionCategory = (typeof FLOW_ACTION_CATEGORIES)[number];

/** One entry of the action library, as the editor draws its palette. */
export interface FlowActionInfo {
  key: string;
  title: string;
  description: string | null;
  category: FlowActionCategory;
  /** The source type it acts on, for its badge; null when it acts on tachy. */
  source: string | null;
  writes: boolean;
  /**
   * JSON Schema. A property whose values come from somewhere carries
   * `x-options` (an option source key), `x-depends-on` (sibling params the
   * source needs) and `x-free` (typed values are fine too).
   */
  params_schema: Record<string, unknown>;
  /** What later steps can read from `steps.<id>`. */
  output_schema: Record<string, unknown>;
}

export interface FlowOption {
  value: string;
  label: string;
  hint?: string;
}

export const FLOW_RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "stopped",
] as const;
export type FlowRunStatus = (typeof FLOW_RUN_STATUSES)[number];

export type FlowStepStatus = "ok" | "failed" | "skipped" | "dry";

export interface FlowStepTrace {
  step_id: string;
  kind: FlowStep["kind"];
  status: FlowStepStatus;
  ms: number;
  /** Params after interpolation, for an action. */
  input?: unknown;
  output?: unknown;
  /** For an if or filter: whether its condition held. */
  held?: boolean;
  error?: string;
}

export interface FlowRun {
  id: string;
  flow_id: string;
  job_run_id: string | null;
  trigger_id: string | null;
  work_item_id: string | null;
  dry_run: boolean;
  status: FlowRunStatus;
  steps: FlowStepTrace[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** `a.b.0.c` into a value; anything missing along the way is undefined. */
export function readPath(from: unknown, path: string): unknown {
  let at: unknown = from;
  for (const key of path.split(".").filter(Boolean)) {
    if (at == null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;
const ONLY_TOKEN = /^\{\{\s*([\w.-]+)\s*\}\}$/;

const asText = (v: unknown) =>
  v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

/**
 * Fills `{{path}}` from the run's context. A value that is one token and
 * nothing else keeps its type, so a list or a number passes through whole;
 * tokens inside text are written as text.
 */
export function interpolate(value: unknown, context: unknown): unknown {
  if (typeof value === "string") {
    const only = value.match(ONLY_TOKEN);
    if (only) return readPath(context, only[1]);
    return value.replace(TOKEN, (_, path: string) =>
      asText(readPath(context, path)),
    );
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, context));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolate(v, context)]),
    );
  return value;
}

const lower = (v: unknown) => asText(v).toLowerCase();

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return a.some((x) => same(x, b));
  return lower(a) === lower(b);
}

function compare(a: unknown, b: unknown): number | null {
  if (a == null || b == null || a === "" || b === "") return null;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const da = Date.parse(String(a));
  const db = Date.parse(String(b));
  if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
  return asText(a).localeCompare(asText(b));
}

/**
 * Whether a condition holds for a subject. Text compares without case, a list
 * field matches when any of its values does, and a condition that cannot be
 * judged (a bad pattern, a missing value to order) does not hold.
 */
export function evaluateCondition(c: Condition, subject: unknown): boolean {
  if ("all" in c) return c.all.every((x) => evaluateCondition(x, subject));
  if ("any" in c) return c.any.some((x) => evaluateCondition(x, subject));
  if ("not" in c) return !evaluateCondition(c.not, subject);
  const v = readPath(subject, c.field);
  switch (c.op) {
    case "eq":
      return same(v, c.value);
    case "neq":
      return !same(v, c.value);
    case "in":
      return (Array.isArray(c.value) ? c.value : [c.value]).some((x) =>
        same(v, x),
      );
    case "contains":
      return Array.isArray(v)
        ? v.some((x) => lower(x) === lower(c.value))
        : lower(v).includes(lower(c.value));
    case "matches":
      try {
        const re = new RegExp(String(c.value ?? ""), "i");
        return Array.isArray(v)
          ? v.some((x) => re.test(asText(x)))
          : re.test(asText(v));
      } catch {
        return false;
      }
    case "exists":
      return !(v == null || v === "" || (Array.isArray(v) && v.length === 0));
    case "gt": {
      const d = compare(v, c.value);
      return d != null && d > 0;
    }
    case "lt": {
      const d = compare(v, c.value);
      return d != null && d < 0;
    }
  }
}
