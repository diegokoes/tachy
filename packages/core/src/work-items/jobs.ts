import { z } from "zod";
import { count } from "../jobs/present";
import { defineJob } from "../jobs/registry";
import { checkFollows } from "./follows";

export function defineWorkItemJobs() {
  defineJob({
    kind: "work_items.follows",
    title: "Check followed items",
    description:
      "Reads the items people follow on the board, each with the follower's own token, and notes what others changed.",
    params: z.object({}),
    defaultSchedule: "*/10 * * * *",
    queue: "sync",
    dedupeKey: () => "all",
    outcome: (o) =>
      [
        `${count(Number(o.checked ?? 0), "item")} read`,
        o.changed ? `${count(Number(o.changed), "change")} noted` : "",
        o.skipped ? `${o.skipped} skipped` : "",
        o.notes ? `${count(Number(o.notes), "note")} posted` : "",
      ]
        .filter(Boolean)
        .join(", "),
    timeout: "15m",
    run: async () => ({ ...(await checkFollows()) }),
  });
}
