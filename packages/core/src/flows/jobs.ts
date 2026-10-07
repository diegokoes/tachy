import { z } from "zod";
import { count } from "../jobs/present";
import { defineJob } from "../jobs/registry";
import { getFlow } from "./definitions";
import { runFlow } from "./run";
import { scheduledItems } from "./triggers";

export function defineFlowJobs(): void {
  defineJob({
    kind: "flow.run",
    title: "Run flow",
    description:
      "One pass of a flow over one item, or a schedule's pass that queues one per matching item.",
    queue: "flows",
    params: z.object({
      flow_id: z.string().uuid(),
      trigger_id: z.string().optional(),
      work_item_id: z.string().uuid().optional(),
      dry_run: z.boolean().default(false),
    }),
    dedupeKey: (p) =>
      `flow:${p.flow_id}:${p.work_item_id ?? p.trigger_id ?? "none"}${p.dry_run ? ":dry" : ""}`,
    subject: (p) => (p.dry_run ? "dry run" : null),
    outcome: (output) => {
      if (typeof output.skipped === "string")
        return `skipped: ${output.skipped}`;
      if (output.matched !== undefined)
        return `${output.queued} of ${count(Number(output.matched), "item")} queued`;
      return output.status ? String(output.status) : null;
    },
    timeout: "15m",
    async run(ctx, params) {
      const flow = await getFlow(params.flow_id);
      const trigger = flow.graph.triggers.find(
        (t) => t.id === params.trigger_id,
      );
      const manual = !trigger || trigger.kind === "manual";
      if (!flow.enabled && !manual && !params.dry_run)
        return { skipped: "the flow is paused" };

      if (trigger?.kind === "schedule" && !params.work_item_id) {
        const itemIds = await scheduledItems(trigger);
        if (itemIds.length || trigger.params.connection) {
          let queued = 0;
          for (const id of itemIds)
            if (
              await ctx.enqueue("flow.run", {
                flow_id: flow.id,
                trigger_id: trigger.id,
                work_item_id: id,
                dry_run: params.dry_run,
              })
            )
              queued++;
          return { matched: itemIds.length, queued };
        }
      }

      const { flowRunId, status } = await runFlow({
        flow,
        triggerId: params.trigger_id ?? null,
        workItemId: params.work_item_id ?? null,
        dryRun: params.dry_run,
        jobRunId: ctx.runId,
        signal: ctx.signal,
        log: ctx.log,
        enqueue: ctx.enqueue,
      });
      return { flow_run_id: flowRunId, status };
    },
  });
}
