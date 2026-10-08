import type { FlowGraph, FlowStepTrace } from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import { chance, intBetween, pick, rngFor, uuidFor } from "./deterministic";
import type { SeededTeam, SeededUser } from "./org";
import type { SeededWorkItem } from "./sources";

const HOUR = 3_600_000;

/** A team's triage flow and a global nightly sweep, with a few days of runs. */
export async function seedFlows(
  tx: Tx,
  teams: SeededTeam[],
  users: SeededUser[],
  connections: { id: string; slug: string }[],
  workItems: SeededWorkItem[],
): Promise<void> {
  const rng = rngFor("flows", 0);
  const admin = users.find((u) => u.role === "admin") ?? users[0];
  const desk = connections[0];
  if (!admin || !desk) return;

  const triage: FlowGraph = {
    triggers: [
      {
        id: "synced",
        kind: "item.synced",
        params: { connection: desk.slug, events: ["created"] },
        where: { field: "item.status", op: "eq", value: "2" },
      },
      { id: "by-hand", kind: "manual", params: {} },
    ],
    steps: [
      {
        id: "knowledge",
        kind: "action",
        action: "knowledge.search",
        params: {},
      },
      {
        id: "bug",
        kind: "if",
        when: { field: "item.tags", op: "contains", value: "bug" },
        then: [
          {
            id: "summary",
            kind: "action",
            action: "agent.ask",
            params: {
              prompt:
                "Summarise the ticket for a developer, with what the knowledge base already says.",
              material: "{{item.title}}\n\n{{steps.knowledge.text}}",
            },
          },
          {
            id: "note",
            kind: "action",
            action: "item.post_note",
            params: { body: "{{steps.summary.text}}" },
          },
        ],
        else: [
          {
            id: "hint",
            kind: "action",
            action: "item.post_note",
            params: { body: "Similar past tickets:\n{{steps.knowledge.text}}" },
          },
        ],
      },
    ],
  };
  const sweep: FlowGraph = {
    triggers: [
      {
        id: "nightly",
        kind: "schedule",
        params: { cron: "15 1 * * *", timezone: "UTC", connection: desk.slug },
        where: { field: "item.status", op: "in", value: ["2", "3"] },
      },
    ],
    steps: [
      {
        id: "stale",
        kind: "filter",
        when: { field: "item.updated_at", op: "lt", value: "2026-01-01" },
      },
      { id: "fetch", kind: "action", action: "item.fetch", params: {} },
    ],
  };

  const created = new Date(Date.now() - 20 * 24 * HOUR);
  const flows = [
    {
      id: uuidFor("flow", 0),
      name: "Triage new tickets",
      team_id: teams[0]?.id ?? null,
      enabled: true,
      graph: triage,
    },
    {
      id: uuidFor("flow", 1),
      name: "Nightly stale sweep",
      team_id: null,
      enabled: false,
      graph: sweep,
    },
  ];
  await insertRows(
    tx,
    "flows",
    [
      "id",
      "name",
      "team_id",
      "enabled",
      "graph",
      "run_as_user_id",
      "created_by",
      "created_at",
      "updated_at",
    ],
    flows.map((f) => ({
      ...f,
      graph: tx.json(f.graph as never),
      run_as_user_id: admin.id,
      created_by: admin.id,
      created_at: created,
      updated_at: created,
    })),
  );

  const deskItems = workItems.filter((w) => w.connectionId === desk.id);
  if (!deskItems.length) return;
  const runs = Array.from({ length: 24 }, (_, i) => {
    const bug = chance(rng, 0.4);
    const failed = chance(rng, 0.1);
    const started = new Date(Date.now() - intBetween(rng, 1, 14 * 24) * HOUR);
    const ms = () => intBetween(rng, 40, 2500);
    const steps: FlowStepTrace[] = [
      {
        step_id: "knowledge",
        kind: "action",
        status: "ok",
        ms: ms(),
        output: { count: intBetween(rng, 0, 5) },
      },
      { step_id: "bug", kind: "if", status: "ok", ms: 0, held: bug },
      ...(bug
        ? ([
            { step_id: "summary", kind: "action", status: "ok", ms: ms() },
            failed
              ? {
                  step_id: "note",
                  kind: "action",
                  status: "failed",
                  ms: ms(),
                  error: "Freshdesk note POST -> 429 Too Many Requests",
                }
              : { step_id: "note", kind: "action", status: "ok", ms: ms() },
          ] satisfies FlowStepTrace[])
        : ([
            { step_id: "hint", kind: "action", status: "ok", ms: ms() },
          ] satisfies FlowStepTrace[])),
    ];
    const total = steps.reduce((n, s) => n + s.ms, 0);
    return {
      id: uuidFor("flow-run", i),
      flow_id: flows[0].id,
      trigger_id: "synced",
      work_item_id: pick(rng, deskItems).id,
      dry_run: false,
      status: bug && failed ? "failed" : "succeeded",
      steps: tx.json(steps as never),
      error:
        bug && failed
          ? "step 'note': Freshdesk note POST -> 429 Too Many Requests"
          : null,
      started_at: started,
      finished_at: new Date(started.getTime() + total),
    };
  });
  await insertRows(
    tx,
    "flow_runs",
    [
      "id",
      "flow_id",
      "trigger_id",
      "work_item_id",
      "dry_run",
      "status",
      "steps",
      "error",
      "started_at",
      "finished_at",
    ],
    runs,
  );
}
