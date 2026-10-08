import { z } from "zod";
import { count } from "../jobs/present";
import { defineJob } from "../jobs/registry";
import { sweepWikiGaps } from "./gaps";

export function defineWikiJobs() {
  defineJob({
    kind: "wiki.gaps",
    title: "Find wiki gaps",
    description:
      "Rescans every wiki for components and lessons that no article covers yet.",
    params: z.object({}),
    defaultSchedule: "7 * * * *",
    outcome: (o) =>
      [
        `${o.gaps ? count(Number(o.gaps), "gap") : "no gaps"} in ${count(Number(o.wikis ?? 0), "wiki")}`,
        o.failed ? `${o.failed} failed` : "",
        o.skipped ? `${o.skipped} skipped` : "",
      ]
        .filter(Boolean)
        .join(", "),
    timeout: "30m",
    run: async () => ({ ...(await sweepWikiGaps()) }),
  });
}
