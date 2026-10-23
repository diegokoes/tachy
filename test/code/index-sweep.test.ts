/**
 * What a restart leaves of a reindex: the API's startup sweep and the job
 * reaper between them mark a line interrupted only once nothing writes it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sweepInterruptedIndexes } from "@tachy/core/code";
import { reapExpiredRuns, registerCoreJobs } from "@tachy/core/jobs";
import { sql, resetJobs } from "../database";

const SLUG = "sweep-repo";

async function lineStatus() {
  const [line] = await sql`
    select l.index_status, l.index_error from repo_lines l
    join repos r on r.id = l.repo_id where r.slug = ${SLUG}
  `;
  return line;
}

async function runningReindex(leaseSeconds: number) {
  await sql`
    insert into job_runs (kind, params, resource_class, queue, trigger, status,
                          timeout_ms, locked_by, locked_until, started_at, attempts)
    values ('repo.reindex', ${sql.json({ repo: SLUG })}, 'heavy', 'index', 'manual',
            'running', 60000, 'other-worker',
            now() + ${leaseSeconds} * interval '1 second', now(), 1)
  `;
}

beforeAll(() => registerCoreJobs());

beforeEach(async () => {
  await resetJobs();
  await sql`delete from repos where slug = ${SLUG}`;
  const [repo] = await sql`
    insert into repos (slug, url) values (${SLUG}, 'https://example.invalid/sweep.git')
    returning id
  `;
  await sql`
    insert into repo_lines (repo_id, ref, index_status)
    values (${repo.id}, 'main', 'indexing')
  `;
});

afterAll(async () => {
  await sql`delete from repos where slug = ${SLUG}`;
  await resetJobs();
});

describe("an interrupted reindex", () => {
  it("is marked at startup when no run is writing it", async () => {
    expect(await sweepInterruptedIndexes()).toBe(1);
    expect(await lineStatus()).toMatchObject({
      index_status: "error",
      index_error: "indexing interrupted (process restarted)",
    });
  });

  it("is left to a run on another worker that still holds its lease", async () => {
    await runningReindex(60);
    expect(await sweepInterruptedIndexes()).toBe(0);
    expect((await lineStatus()).index_status).toBe("indexing");
  });

  it("is marked by the reaper once that worker stops heartbeating", async () => {
    await runningReindex(-1);
    expect(await reapExpiredRuns()).toBe(1);
    expect(await lineStatus()).toMatchObject({
      index_status: "error",
      index_error: "indexing interrupted (its worker stopped)",
    });
  });
});
