import {
  evaluateCondition,
  type FlowGraph,
  type FlowTrigger,
} from "@tachy/contract";
import { jsonb, sql } from "../infra/db";
import { log } from "../infra/log";
import { enqueueRun } from "../jobs/runs";
import { loadSubject, recentSubjects } from "./subject";

export type ItemEvent = "created" | "updated";

interface Armed {
  flowId: string;
  trigger: FlowTrigger;
}

const eventsOf = (t: FlowTrigger): ItemEvent[] => {
  const e = t.params.events;
  return Array.isArray(e) && e.length
    ? (e.filter((x) => x === "created" || x === "updated") as ItemEvent[])
    : ["created", "updated"];
};

/**
 * The enabled flows a connection's sync can start, read once per sync. Null
 * when there are none, so a sync with no flows pays one query and nothing per
 * item.
 */
export async function itemTriggers(
  connection: string,
): Promise<((itemId: string, event: ItemEvent) => Promise<void>) | null> {
  const rows = await sql`
    select id, graph from flows
    where enabled and graph->'triggers' @> ${jsonb([{ kind: "item.synced", params: { connection } }])}
  `;
  const armed: Armed[] = rows.flatMap((r) =>
    (r.graph as FlowGraph).triggers
      .filter(
        (t) => t.kind === "item.synced" && t.params.connection === connection,
      )
      .map((trigger) => ({ flowId: r.id as string, trigger })),
  );
  if (!armed.length) return null;

  /* A flow must never fail the sync that fed it: a bad condition or a full
     queue is logged, and the item is stored all the same. */
  return async (itemId, event) => {
    try {
      const hits = armed.filter((a) => eventsOf(a.trigger).includes(event));
      if (!hits.length) return;
      const item = hits.some((a) => a.trigger.where)
        ? await loadSubject(itemId)
        : null;
      for (const a of hits) {
        if (a.trigger.where && !evaluateCondition(a.trigger.where, { item }))
          continue;
        await enqueueRun({
          kind: "flow.run",
          params: {
            flow_id: a.flowId,
            trigger_id: a.trigger.id,
            work_item_id: itemId,
          },
          trigger: "event",
        });
      }
    } catch (e) {
      log("warn", "flow_trigger_failed", {
        connection,
        item: itemId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
}

/**
 * A schedule trigger with a connection runs the flow once per recent item of
 * it that passes the trigger's condition; the ids come back for the job to
 * queue as its children.
 */
export async function scheduledItems(t: FlowTrigger): Promise<string[]> {
  const connection = t.params.connection;
  if (typeof connection !== "string" || !connection) return [];
  const sinceDays = Number(t.params.since_days ?? 7);
  const max = Math.min(Number(t.params.max_items ?? 50), 500);
  const items = await recentSubjects(connection, {
    sinceDays,
    limit: 2000,
  });
  return items
    .filter((item) => !t.where || evaluateCondition(t.where, { item }))
    .slice(0, max)
    .map((i) => i.id);
}
