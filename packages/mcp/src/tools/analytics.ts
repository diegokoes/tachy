/** What a run cost, reported by the agent that ran it. */
import { z } from "zod";
import { resolveCurrentUserId } from "@tachy/core/access";
import { recordRun } from "@tachy/core/analytics";
import { runModeSchema } from "@tachy/core/knowledge";
import { tool } from "../server";
import { out } from "../results";

tool(
  "record_analysis_run",
  {
    description:
      "Report token usage for an ingest/consult analysis run, for audit and cost accounting. Pass the input/output tokens you used.",
    inputSchema: {
      mode: runModeSchema,
      work_item_id: z.string().optional(),
      model: z.string().optional(),
      input_tokens: z
        .number()
        .int()
        .optional()
        .describe(
          "Actual tokens consumed. These rows are what the cost report adds up, so an estimate here becomes a figure someone reads as measured.",
        ),
      output_tokens: z.number().int().optional(),
      meta: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Free-form context for this run - the work item, the source, what was attempted. Not a place for the content itself.",
        ),
    },
  },
  async (a) => {
    const row = await recordRun({
      mode: a.mode,
      workItemId: a.work_item_id,
      userId: await resolveCurrentUserId(),
      model: a.model,
      inputTokens: a.input_tokens,
      outputTokens: a.output_tokens,
      meta: a.meta,
    });
    return out({ recorded: true, id: row.id });
  },
);
