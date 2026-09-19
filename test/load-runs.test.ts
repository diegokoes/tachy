import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cancelTestRun,
  inLoadWindow,
  listTestRuns,
  loadTargets,
  registerCoreJobs,
  runSystemChecks,
  startTestRun,
} from "@tachy/core";
import { resetData, sql, resetJobs } from "./helpers";

afterAll(() => {
  delete process.env.TACHY_LOAD_TARGETS;
  return sql.end();
});

registerCoreJobs();

beforeEach(async () => {
  await resetData();
  await resetJobs();
  process.env.TACHY_LOAD_TARGETS =
    "production=http://api:8787,dev=http://dev:8787";
});

const workHours = new Date("2026-09-16T10:00:00");
const evening = new Date("2026-09-16T21:00:00");

describe("load run guardrails", () => {
  it("reads targets from the environment and knows the window", () => {
    expect(loadTargets()).toEqual([
      { name: "production", url: "http://api:8787", dev: false },
      { name: "dev", url: "http://dev:8787", dev: true },
    ]);
    expect(inLoadWindow(workHours)).toBe(false);
    expect(inLoadWindow(evening)).toBe(true);
  });

  it("allows smoke against production at any hour", async () => {
    const run = await startTestRun({
      script: "smoke.js",
      target: "production",
      requestedBy: null,
      now: workHours,
    });
    expect(run).toMatchObject({ status: "queued", script: "smoke.js" });
    const [job] =
      await sql`select kind, params from job_runs where id = ${run.job_run_id}`;
    expect(job).toMatchObject({
      kind: "load.test",
      params: { test_run_id: run.id },
    });
  });

  it("refuses unknown scripts and targets, heavy scripts and working hours", async () => {
    const cases: [Parameters<typeof startTestRun>[0], RegExp][] = [
      [
        { script: "nope.js", target: "production", requestedBy: null },
        /unknown script/,
      ],
      [
        { script: "smoke.js", target: "nowhere", requestedBy: null },
        /unknown target/,
      ],
      [
        { script: "spike.js", target: "production", requestedBy: null },
        /only against a dev target/,
      ],
      [
        {
          script: "smoke.js",
          target: "production",
          profile: "stress",
          requestedBy: null,
        },
        /stress/,
      ],
      [
        {
          script: "search.js",
          target: "production",
          requestedBy: null,
          now: workHours,
        },
        /outside working hours/,
      ],
    ];
    for (const [input, message] of cases)
      await expect(startTestRun(input)).rejects.toThrow(message);

    await expect(
      startTestRun({
        script: "search.js",
        target: "production",
        requestedBy: null,
        now: evening,
      }),
    ).resolves.toMatchObject({ status: "queued" });
    await expect(
      startTestRun({
        script: "spike.js",
        target: "dev",
        requestedBy: null,
        now: workHours,
      }),
    ).rejects.toThrow(/already going/);
  });

  it("cancels a run and lets the next one start", async () => {
    const run = await startTestRun({
      script: "smoke.js",
      target: "production",
      requestedBy: null,
      now: workHours,
    });
    expect((await cancelTestRun(run.id)).status).toBe("cancelled");
    await expect(
      startTestRun({
        script: "smoke.js",
        target: "production",
        requestedBy: null,
        now: workHours,
      }),
    ).resolves.toMatchObject({ status: "queued" });
    expect(await listTestRuns()).toHaveLength(2);
  });
});

describe("system checks", () => {
  it("reports the database, the embedding model and the agent backends", async () => {
    const checks = await runSystemChecks();
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName.database.state).toBe("pass");
    // Over 2 s is a warn; under a loaded parallel suite that is timing, not
    // a broken model. The dimension in the detail is what proves it answered.
    expect(["pass", "warn"]).toContain(byName.embedding.state);
    expect(byName.embedding.detail).toMatch(/768-dim/);
    expect(byName["agent claude"]).toBeDefined();
    expect(
      checks.every((c) => ["pass", "warn", "fail", "skip"].includes(c.state)),
    ).toBe(true);
  }, 60_000);
});
