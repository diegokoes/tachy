import { spawn } from "node:child_process";
import { z } from "zod";
import { sql, jsonb } from "../infra/db";
import { badInput, conflict, notFound } from "../infra/errors";
import { env } from "../infra/env";
import { defineJob } from "../jobs/registry";
import { enqueueRun } from "../jobs/runs";

/**
 * Which scripts may run against which targets (DEPLOYMENT-ARCHITECTURE.md
 * §11.3). Targets are named in TACHY_LOAD_TARGETS (`name=url,name=url`), never
 * typed in, so the page cannot be aimed at anything else.
 */
export const LOAD_SCRIPTS = {
  "smoke.js": { anyTime: true },
  "browse.js": { anyTime: false },
  "search.js": { anyTime: false },
  "contention.js": { anyTime: false },
  "soak.js": { anyTime: false, devOnly: true },
  "spike.js": { anyTime: false, devOnly: true },
  "breakpoint.js": { anyTime: false, devOnly: true },
  "mixed.js": { anyTime: false, devOnly: true },
} as const;
export type LoadScript = keyof typeof LOAD_SCRIPTS;

export interface LoadTarget {
  name: string;
  url: string;
  /** A target that is not production: the heavy scripts may run against it. */
  dev: boolean;
}

export function loadTargets(): LoadTarget[] {
  return (process.env.TACHY_LOAD_TARGETS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, url] = entry.split("=");
      return { name, url, dev: /^dev\b|-dev$|dev$/.test(name ?? "") };
    })
    .filter((t) => t.name && t.url);
}

/** Weekdays 19:00–07:00 and weekends, in the server's timezone. */
export function inLoadWindow(now = new Date()): boolean {
  const day = now.getDay();
  const hour = now.getHours();
  return day === 0 || day === 6 || hour >= 19 || hour < 7;
}

export interface TestRun {
  id: string;
  script: string;
  profile: string | null;
  target: string;
  status: "queued" | "running" | "passed" | "failed" | "cancelled" | "error";
  requested_by: string | null;
  image_sha: string | null;
  job_run_id: string | null;
  summary: Record<string, unknown> | null;
  output_tail: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export async function listTestRuns(limit = 30): Promise<TestRun[]> {
  return (await sql`
    select * from test_runs order by created_at desc limit ${Math.min(limit, 200)}
  `) as never;
}

export async function getTestRun(id: string): Promise<TestRun> {
  const [row] = await sql`select * from test_runs where id = ${id}`;
  if (!row) throw notFound(`test run ${id} not found`);
  return row as never;
}

/**
 * Queues a load run, refusing anything the guardrails rule out: an unknown
 * script or target, a heavy script outside the dev stack, a production run
 * outside the off-hours window, or a second run while one is going.
 */
export async function startTestRun(i: {
  script: string;
  profile?: string | null;
  target: string;
  requestedBy: string | null;
  now?: Date;
}): Promise<TestRun> {
  const script = i.script as LoadScript;
  const rules = LOAD_SCRIPTS[script];
  if (!rules) throw badInput(`unknown script '${i.script}'`);
  const target = loadTargets().find((t) => t.name === i.target);
  if (!target)
    throw badInput(
      `unknown target '${i.target}'. Targets come from TACHY_LOAD_TARGETS.`,
    );
  const heavy = "devOnly" in rules && rules.devOnly;
  if (heavy && !target.dev)
    throw badInput(
      `${script} runs only against a dev target, not '${target.name}'`,
    );
  if (i.profile === "stress" && !target.dev)
    throw badInput("PROFILE=stress runs only against a dev target");
  if (!target.dev && !rules.anyTime && !inLoadWindow(i.now))
    throw badInput(
      `${script} may only run against ${target.name} outside working hours (weekdays 19:00–07:00, or weekends)`,
    );

  const [row] = await sql`
    insert into test_runs (script, profile, target, requested_by, image_sha)
    select ${script}, ${i.profile ?? null}, ${target.name}, ${i.requestedBy}, ${env.commit ?? null}
    where not exists (select 1 from test_runs where status in ('queued','running'))
    returning *
  `;
  if (!row)
    throw conflict("a load run is already going; wait for it or cancel it");

  const jobRunId = await enqueueRun({
    kind: "load.test",
    params: { test_run_id: row.id },
    trigger: "manual",
    requestedBy: i.requestedBy,
  });
  await sql`update test_runs set job_run_id = ${jobRunId} where id = ${row.id}`;
  return { ...(row as never as TestRun), job_run_id: jobRunId };
}

export async function cancelTestRun(id: string): Promise<TestRun> {
  const run = await getTestRun(id);
  if (run.job_run_id) {
    const { cancelRun } = await import("../jobs/runs");
    await cancelRun(run.job_run_id).catch(() => {});
  }
  const [row] = await sql`
    update test_runs set status = 'cancelled', finished_at = now()
    where id = ${id} and status in ('queued','running') returning *
  `;
  return (row as never) ?? run;
}

const TAIL = 8_000;

export function defineLoadTestJobs() {
  defineJob({
    kind: "load.test",
    title: "Run a load script",
    description:
      "Runs one k6 script from load/ against a configured target. Started from the admin page, never by a schedule.",
    params: z.object({ test_run_id: z.string().uuid() }),
    resourceClass: "heavy",
    timeout: "45m",
    run: async (ctx, p) => {
      const run = await getTestRun(p.test_run_id);
      const target = loadTargets().find((t) => t.name === run.target);
      if (!target)
        throw badInput(`target '${run.target}' is no longer configured`);
      await sql`update test_runs set status = 'running', started_at = now() where id = ${run.id}`;

      const args = [
        "run",
        "--quiet",
        "--summary-export",
        "/tmp/k6-summary.json",
        `load/${run.script}`,
      ];
      const child = spawn(process.env.TACHY_K6_BIN ?? "k6", args, {
        env: {
          ...process.env,
          BASE_URL: target.url,
          ...(run.profile ? { PROFILE: run.profile } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let tail = "";
      const collect = (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-TAIL);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      // Cancel sends SIGINT, so k6 still writes its summary.
      ctx.signal.addEventListener("abort", () => child.kill("SIGINT"));

      const code = await new Promise<number>((resolve) =>
        child.on("close", resolve),
      );
      const { readFile } = await import("node:fs/promises");
      const summary = await readFile("/tmp/k6-summary.json", "utf8")
        .then((s) => JSON.parse(s) as Record<string, unknown>)
        .catch(() => null);
      const status = ctx.signal.aborted
        ? "cancelled"
        : code === 0
          ? "passed"
          : code === 99
            ? "failed"
            : "error";
      await sql`
        update test_runs set status = ${status}, finished_at = now(),
          summary = ${summary ? jsonb(summary) : null}, output_tail = ${tail}
        where id = ${run.id}
      `;
      ctx.log(`${run.script} against ${run.target}: ${status}`);
      return { test_run: run.id, status, exit_code: code };
    },
  });
}
