import { defineCodeJobs } from "../code/jobs";
import { defineRetentionJobs } from "../compliance/retention";
import { sql } from "../infra/db";
import { log } from "../infra/log";
import { defineSearchJobs } from "../search/jobs";
import { defineSourceJobs } from "../sources/jobs";
import { defineWikiJobs } from "../wiki/jobs";
import { createJobDefinition } from "./definitions";
import { notifyRunFinished } from "./notify";
import { describeJobKinds } from "./registry";
import { startJobWorker } from "./worker";

/** Every kind core ships. The worker and the API both call this at start. */
export function registerCoreJobs(): void {
  defineCodeJobs();
  defineSourceJobs();
  defineSearchJobs();
  defineWikiJobs();
  defineRetentionJobs();
}

/**
 * A definition for each kind with a default schedule, created once. One an
 * admin deleted stays deleted: the change log remembers it.
 */
export async function ensureDefaultDefinitions(): Promise<string[]> {
  const created: string[] = [];
  for (const k of describeJobKinds()) {
    if (!k.default_schedule) continue;
    const name = k.title;
    const [seen] = await sql`
      select 1 from job_definitions where kind = ${k.kind}
      union all
      select 1 from job_definition_changes
      where action = 'deleted' and old_value->>'kind' = ${k.kind}
      limit 1
    `;
    if (seen) continue;
    try {
      await createJobDefinition(
        { kind: k.kind, name, schedule: k.default_schedule },
        null,
      );
      created.push(name);
    } catch (err) {
      log("warn", "job_default_definition_failed", {
        kind: k.kind,
        error: String(err),
      });
    }
  }
  return created;
}

/**
 * What a process that runs jobs does at start: register the kinds, create the
 * default definitions, and work the given classes. A run that ignores its
 * cancel signal past the grace period restarts the process, the only way to
 * stop code already running in it.
 */
export async function startJobProcess(opts: {
  classes: string[];
  concurrency: number;
}) {
  registerCoreJobs();
  const created = await ensureDefaultDefinitions();
  if (created.length) log("info", "job_default_definitions", { created });
  return startJobWorker({
    ...opts,
    onFinished: notifyRunFinished,
    onStuck: () => process.exit(1),
  });
}
