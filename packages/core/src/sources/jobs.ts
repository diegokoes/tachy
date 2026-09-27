import { z } from "zod";
import { defineJob } from "../jobs/registry";
import { syncSource } from "./sync";

export function defineSourceJobs() {
  defineJob({
    kind: "source.sync",
    title: "Sync a source connection",
    description:
      "Pulls work items changed since the connection's last clean sync.",
    params: z.object({ connection: z.string().min(1) }),
    connection: "any",
    timeout: "1h",
    maxAttempts: 3,
    run: async (ctx, p) => {
      const { total, since } = await syncSource(p.connection, {
        signal: ctx.signal,
        onPage: (n) => ctx.log(`${n} item(s) so far`),
      });
      return { items: total, since: since ?? null };
    },
  });
}
