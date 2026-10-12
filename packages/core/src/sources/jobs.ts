import { z } from "zod";
import { count } from "../jobs/present";
import { defineJob } from "../jobs/registry";
import { syncSource } from "./sync";

const isDateOrEmpty = (text: string) =>
  text.trim() === "" || !Number.isNaN(Date.parse(text));

export function defineSourceJobs() {
  defineJob({
    kind: "source.sync",
    title: "Sync source",
    description:
      "Pulls work items changed since the connection's last clean sync.",
    params: z.object({
      connection: z.string().min(1),
      from: z
        .string()
        .refine(isDateOrEmpty, "not a date")
        .optional()
        .describe(
          "How far back the copy reaches, as a date. One run walks from it; later runs resume from the last clean sync.",
        ),
    }),
    connection: "any",
    queue: "sync",
    dedupeKey: (p) => p.connection,
    subject: (p) => p.connection,
    outcome: (o) => `${count(Number(o.total ?? 0), "item")} pulled`,
    timeout: "1h",
    maxAttempts: 3,
    run: async (ctx, params) => {
      const { total, since } = await syncSource(params.connection, {
        from: params.from,
        signal: ctx.signal,
        onPage: (n) => ctx.log(`${n} item(s) so far`),
      });
      return { total, since: since ?? null };
    },
  });
}
