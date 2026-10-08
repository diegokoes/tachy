import { z } from "zod";
import { count } from "../jobs/present";
import { defineJob } from "../jobs/registry";
import { syncSource } from "./sync";

export function defineSourceJobs() {
  defineJob({
    kind: "source.sync",
    title: "Sync source",
    description:
      "Pulls work items changed since the connection's last clean sync.",
    params: z.object({ connection: z.string().min(1) }),
    connection: "any",
    queue: "sync",
    dedupeKey: (p) => p.connection,
    subject: (p) => p.connection,
    outcome: (o) => `${count(Number(o.total ?? 0), "item")} pulled`,
    timeout: "1h",
    maxAttempts: 3,
    run: async (ctx, params) => {
      const { total, since } = await syncSource(params.connection, {
        signal: ctx.signal,
        onPage: (n) => ctx.log(`${n} item(s) so far`),
      });
      return { items: total, since: since ?? null };
    },
  });
}
