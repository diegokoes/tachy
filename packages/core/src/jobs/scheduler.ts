import { Cron } from "croner";
import { sql } from "../infra/db";
import { log } from "../infra/log";
import { enqueueRun } from "./runs";
import { getJobKind, hasJobKind } from "./registry";

/** A firing this late is a missed one, subject to the kind's `missed` policy. */
const ON_TIME_MS = 2 * 60_000;
const LOCK_KEY = 7_311_902_451;

/**
 * Inserts the runs that are due. Every worker may call it; the advisory lock
 * lets one at a time through, and the unique (definition, slot) makes a double
 * firing insert one run. After downtime a definition gets at most one run for
 * everything it missed.
 */
export async function scheduleDueRuns(now = new Date()): Promise<number> {
  return sql.begin(async (tx) => {
    const [{ locked }] =
      await tx`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`;
    if (!locked) return 0;
    let inserted = 0;
    const due = await tx`
      select id, kind, schedule, timezone, coalesce(last_scheduled_for, created_at) as anchor
      from job_definitions
      where enabled and schedule is not null
    `;
    for (const d of due) {
      if (!hasJobKind(d.kind)) continue;
      const cron = new Cron(d.schedule, { timezone: d.timezone });
      let slot = cron.nextRun(new Date(d.anchor));
      if (!slot || slot > now) continue;
      for (let i = 0; i < 100_000; i++) {
        const next = cron.nextRun(slot);
        if (!next || next > now) break;
        slot = next;
      }
      const late = now.getTime() - slot.getTime() > ON_TIME_MS;
      if (!late || getJobKind(d.kind).missed === "run-once") {
        const [def] =
          await tx`select params from job_definitions where id = ${d.id}`;
        const id = await enqueueRun({
          kind: d.kind,
          params: def.params,
          trigger: "schedule",
          definitionId: d.id,
          scheduledFor: slot,
          db: tx,
        });
        if (id) inserted++;
        if (late)
          log("info", "job_missed_run_once", { definition: d.id, slot });
      }
      await tx`update job_definitions set last_scheduled_for = ${slot} where id = ${d.id}`;
    }
    return inserted;
  }) as Promise<number>;
}
