import { z } from "zod";
import { defineJob } from "../jobs/registry";
import { getFlow } from "./definitions";
import { runFlow } from "./run";
import { scheduledItems } from "./triggers";

export function defineFlowJobs(): void {
  defineJob({
    kind: "flow.run",
    title: "Run a flow",
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
    timeout: "15m",
    async run(ctx, p) {
      const flow = await getFlow(p.flow_id);
      const trigger = flow.graph.triggers.find((t) => t.id === p.trigger_id);
      const manual = !trigger || trigger.kind === "manual";
      if (!flow.enabled && !manual && !p.dry_run)
        return { skipped: "the flow is paused" };

      if (trigger?.kind === "schedule" && !p.work_item_id) {
        const items = await scheduledItems(trigger);
        if (items.length || trigger.params.connection) {
          let queued = 0;
          for (const id of items)
            if (
              await ctx.enqueue("flow.run", {
                flow_id: flow.id,
                trigger_id: trigger.id,
                work_item_id: id,
                dry_run: p.dry_run,
              })
            )
              queued++;
          return { matched: items.length, queued };
        }
      }

      const { flowRunId, status } = await runFlow({
        flow,
        triggerId: p.trigger_id ?? null,
        workItemId: p.work_item_id ?? null,
        dryRun: p.dry_run,
        jobRunId: ctx.runId,
        signal: ctx.signal,
        log: ctx.log,
        enqueue: ctx.enqueue,
      });
      return { flow_run_id: flowRunId, status };
    },
  });
}
