import { z } from "zod";
import { count } from "../jobs/present";
import { defineJob } from "../jobs/registry";
import { sweepSignals } from "./signals";

export function defineReviewJobs() {
  defineJob({
    kind: "review.signals",
    title: "find entries to review",
    description:
      "rescans the knowledge entries for reasons to read one again: later tickets that match it, corrections, low ratings, near copies, a source ticket that moved on, and old entries still read",
    params: z.object({}),
    defaultSchedule: "23 4 * * *",
    outcome: (o) =>
      [
        `${count(Number(o.flagged ?? 0), "entry", "entries")} flagged of ${count(Number(o.signals ?? 0), "signal")}`,
        o.failed ? `${o.failed} failed` : "",
        o.skipped ? `${o.skipped} skipped` : "",
      ]
        .filter(Boolean)
        .join(", "),
    timeout: "30m",
    run: async () => ({ ...(await sweepSignals()) }),
  });
}
