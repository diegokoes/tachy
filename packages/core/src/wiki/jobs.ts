import { z } from "zod";
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
    timeout: "30m",
    run: async () => ({ ...(await sweepWikiGaps()) }),
  });
}
