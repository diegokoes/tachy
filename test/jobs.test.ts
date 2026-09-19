import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  cancelRun,
  claimRun,
  createJobDefinition,
  defineJob,
  describeJobKinds,
  disableInvalidDefinitions,
  enqueueRun,
  finishRun,
  getJobRun,
  heartbeatRun,
  jobCensus,
  jobIssues,
  listJobDefinitionChanges,
  previewSchedule,
  reapExpiredRuns,
  scheduleDueRuns,
  startJobWorker,
  startJobProcess,
  updateJobDefinition,
} from "@tachy/core";
import { sql, resetJobs } from "./helpers";

afterAll(() => sql.end());

const calls: string[] = [];

defineJob({
  kind: "test.echo",
  title: "Echo",
  params: z.object({
    word: z.string().default("hi"),
    fail: z.boolean().default(false),
  }),
  timeout: "1m",
  maxAttempts: 2,
  run: async (ctx, p) => {
    ctx.log(`saying ${p.word}`);
    await ctx.progress(0.5, "half");
    calls.push(p.word);
    if (p.fail) throw new Error("asked to fail");
    return { said: p.word };
  },
});
defineJob({
  kind: "test.skip-missed",
  title: "Skips missed firings",
  params: z.object({}),
  timeout: "1m",
  missed: "skip",
  run: async () => {},
});
defineJob({
  kind: "test.slow",
  title: "Waits for its signal",
  params: z.object({}),
  timeout: "1s",
  resourceClass: "heavy",
  run: (ctx) =>
    new Promise((_, reject) =>
      ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason)),
    ),
});

beforeEach(async () => {
  await resetJobs();
  calls.length = 0;
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

describe("job definitions", () => {
  it("describes kinds with a JSON Schema the SPA can render", () => {
    const echo = describeJobKinds().find((k) => k.kind === "test.echo")!;
    expect(echo.params_schema).toMatchObject({
      type: "object",
      properties: { word: { type: "string", default: "hi" } },
    });
    expect(echo.max_attempts).toBe(2);
  });

  it("refuses bad params, schedules and timezones, and records every change", async () => {
    await expect(
      createJobDefinition(
        { kind: "test.echo", name: "x", params: { word: 3 } },
        null,
      ),
    ).rejects.toThrow(/params for test.echo/);
    await expect(
      createJobDefinition(
        { kind: "test.echo", name: "x", schedule: "not cron" },
        null,
      ),
    ).rejects.toThrow(/schedule/);
    await expect(
      createJobDefinition(
        { kind: "test.echo", name: "x", timezone: "Mars/Olympus" },
        null,
      ),
    ).rejects.toThrow(/timezone/);
    await expect(
      createJobDefinition({ kind: "nope", name: "x" }, null),
    ).rejects.toThrow(/unknown job kind/);

    const d = await createJobDefinition(
      {
        kind: "test.echo",
        name: "echo nightly",
        schedule: "0 2 * * *",
        timezone: "Europe/Berlin",
      },
      null,
    );
    await updateJobDefinition(d.id, { params: { word: "bye" } }, null);
    const changes = await listJobDefinitionChanges(d.id);
    expect(changes.map((c) => c.action)).toEqual(["updated", "created"]);
    expect(previewSchedule("0 2 * * *", "UTC", 2)).toHaveLength(2);
  });

  it("disables stored definitions whose params stopped validating", async () => {
    const d = await createJobDefinition(
      { kind: "test.echo", name: "echo" },
      null,
    );
    await sql`update job_definitions set params = '{"word": 42}' where id = ${d.id}`;
    expect(await disableInvalidDefinitions()).toEqual(["echo"]);
    const [row] =
      await sql`select enabled, disabled_reason from job_definitions where id = ${d.id}`;
    expect(row.enabled).toBe(false);
    expect(row.disabled_reason).toMatch(/params no longer valid/);
  });
});

describe("job runs", () => {
  it("claims the oldest run of the worker's class, and only once", async () => {
    const light = await enqueueRun({
      kind: "test.echo",
      params: {},
      trigger: "manual",
    });
    await enqueueRun({ kind: "test.slow", params: {}, trigger: "manual" });
    const [a, b] = await Promise.all([
      claimRun(["light"], "w1", 60_000),
      claimRun(["light"], "w2", 60_000),
    ]);
    expect([a?.id, b?.id].filter(Boolean)).toEqual([light]);
    expect(await claimRun(["light"], "w1", 60_000)).toBeNull();
    expect((await claimRun(["heavy"], "w1", 60_000))?.kind).toBe("test.slow");
  });

  it("retries a failure with backoff until attempts run out", async () => {
    const id = (await enqueueRun({
      kind: "test.echo",
      params: {},
      trigger: "manual",
    }))!;
    await claimRun(["light"], "w", 60_000);
    let run = await finishRun(id, "w", {
      status: "failed",
      error: "boom",
      logTail: "",
    });
    expect(run?.status).toBe("queued");
    expect(new Date(run!.run_after).getTime()).toBeGreaterThan(
      Date.now() + 20_000,
    );

    await sql`update job_runs set run_after = now() where id = ${id}`;
    await claimRun(["light"], "w", 60_000);
    run = await finishRun(id, "w", {
      status: "failed",
      error: "boom",
      logTail: "",
    });
    expect(run).toMatchObject({ status: "failed", attempts: 2, error: "boom" });
  });

  it("cancels a queued run outright and asks a running one to stop", async () => {
    const queued = (await enqueueRun({
      kind: "test.echo",
      params: {},
      trigger: "manual",
    }))!;
    expect((await cancelRun(queued)).status).toBe("cancelled");

    const running = (await enqueueRun({
      kind: "test.echo",
      params: {},
      trigger: "manual",
    }))!;
    await claimRun(["light"], "w", 60_000);
    await cancelRun(running);
    expect(await heartbeatRun(running, "w", 60_000, {})).toEqual({
      cancelRequested: true,
      lost: false,
    });
  });

  it("requeues a run whose worker stopped heartbeating", async () => {
    const id = (await enqueueRun({
      kind: "test.echo",
      params: {},
      trigger: "manual",
    }))!;
    await claimRun(["light"], "w", 60_000);
    await sql`update job_runs set locked_until = now() - interval '1 second' where id = ${id}`;
    expect(await reapExpiredRuns()).toBe(1);
    expect((await getJobRun(id)).status).toBe("queued");
  });
});

describe("the scheduler", () => {
  it("fires a due slot once, even when called twice at once", async () => {
    const d = await createJobDefinition(
      { kind: "test.echo", name: "every 5", schedule: "*/5 * * * *" },
      null,
    );
    const now = new Date();
    await sql`update job_definitions set last_scheduled_for = ${minutesAgo(6)} where id = ${d.id}`;
    const inserted = await Promise.all([
      scheduleDueRuns(now),
      scheduleDueRuns(now),
    ]);
    expect(inserted.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await scheduleDueRuns(now)).toBe(0);
    const runs = await sql`select trigger, scheduled_for from job_runs`;
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger).toBe("schedule");
  });

  it("runs once for everything missed during downtime, or skips it", async () => {
    const once = await createJobDefinition(
      { kind: "test.echo", name: "missed once", schedule: "*/5 * * * *" },
      null,
    );
    const skip = await createJobDefinition(
      {
        kind: "test.skip-missed",
        name: "missed skip",
        schedule: "*/5 * * * *",
      },
      null,
    );
    await sql`update job_definitions set last_scheduled_for = ${minutesAgo(600)}`;
    const now = new Date(Math.floor(Date.now() / 300_000) * 300_000 + 200_000);
    await scheduleDueRuns(now);
    const runs = await sql`select definition_id from job_runs`;
    expect(runs.map((r) => r.definition_id)).toEqual([once.id]);
    const [s] =
      await sql`select last_scheduled_for from job_definitions where id = ${skip.id}`;
    expect(
      now.getTime() - new Date(s.last_scheduled_for).getTime(),
    ).toBeLessThan(300_000);
  });

  it("skips a firing while the previous run is still going", async () => {
    const d = await createJobDefinition(
      { kind: "test.echo", name: "no overlap", schedule: "* * * * *" },
      null,
    );
    await enqueueRun({
      kind: "test.echo",
      params: {},
      trigger: "manual",
      definitionId: d.id,
    });
    await sql`update job_definitions set last_scheduled_for = ${minutesAgo(2)}`;
    await scheduleDueRuns();
    expect(await sql`select 1 from job_runs`).toHaveLength(1);
  });
});

describe("the worker", () => {
  it("runs a job to completion with progress, output and a log tail", async () => {
    const finished: string[] = [];
    const worker = await startJobWorker({
      classes: ["light"],
      concurrency: 2,
      pollMs: 100,
      scheduleMs: 60_000,
      onFinished: (run) => void finished.push(run.status),
    });
    try {
      const id = (await enqueueRun({
        kind: "test.echo",
        params: { word: "hello" },
        trigger: "manual",
      }))!;
      for (let i = 0; i < 50 && !finished.length; i++)
        await new Promise((r) => setTimeout(r, 100));
      const run = await getJobRun(id);
      expect(run).toMatchObject({
        status: "succeeded",
        progress: 1,
        output: { said: "hello" },
      });
      expect(run.log_tail).toMatch(/saying hello/);
      expect(finished).toEqual(["succeeded"]);
    } finally {
      await worker.drain(1_000);
    }
  });

  it("times out a run that outlives its timeout", async () => {
    const worker = await startJobWorker({
      classes: ["heavy"],
      concurrency: 1,
      pollMs: 100,
      scheduleMs: 60_000,
      graceMs: 500,
    });
    try {
      const id = (await enqueueRun({
        kind: "test.slow",
        params: {},
        trigger: "manual",
      }))!;
      let run = await getJobRun(id);
      for (let i = 0; i < 60 && run.status !== "timed_out"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        run = await getJobRun(id);
      }
      expect(run.status).toBe("timed_out");
    } finally {
      await worker.drain(1_000);
    }
  });
});

describe("the job census", () => {
  const run = (r: {
    kind?: string;
    status: string;
    trigger?: string;
    cls?: "light" | "heavy";
    seconds?: number;
    definitionId?: string | null;
    createdMinutesAgo?: number;
  }) => sql`
    insert into job_runs
      (kind, resource_class, trigger, status, timeout_ms, definition_id,
       created_at, run_after, started_at, finished_at)
    values (
      ${r.kind ?? "test.echo"}, ${r.cls ?? "light"}, ${r.trigger ?? "manual"}, ${r.status},
      60000, ${r.definitionId ?? null},
      ${minutesAgo(r.createdMinutesAgo ?? 5)}, ${minutesAgo(r.createdMinutesAgo ?? 5)},
      ${r.seconds === undefined ? null : minutesAgo(5)},
      ${r.seconds === undefined ? null : new Date(minutesAgo(5).getTime() + r.seconds * 1000)}
    )
  `;

  it("is all zeroes with a filled run of days when nothing has run", async () => {
    const j = await jobCensus(14);
    expect(j.runs).toBe(0);
    expect(j.per_day).toHaveLength(14);
    expect(j.by_kind).toEqual([]);
    expect(j.definitions).toMatchObject({ total: 0, scheduled: 0 });
    expect(j.upcoming).toEqual([]);
  });

  it("splits runs by outcome, trigger and pool, and times each kind", async () => {
    await run({ status: "succeeded", trigger: "schedule", seconds: 10 });
    await run({ status: "succeeded", trigger: "schedule", seconds: 30 });
    await run({ status: "failed", trigger: "manual", seconds: 2 });
    await run({
      kind: "test.slow",
      cls: "heavy",
      status: "timed_out",
      seconds: 60,
    });
    await run({ kind: "test.slow", cls: "heavy", status: "running" });
    await run({ status: "queued", trigger: "event" });
    await run({ status: "succeeded", createdMinutesAgo: 60 * 24 * 20 });

    const j = await jobCensus(14);
    expect(j.runs).toBe(6);
    expect(j.by_status).toMatchObject({
      succeeded: 2,
      failed: 1,
      timed_out: 1,
      running: 1,
      queued: 1,
    });
    expect(j.by_trigger).toEqual({ schedule: 2, manual: 3, event: 1 });
    expect(j.by_class).toEqual({ light: 4, heavy: 2 });
    expect(j.success).toEqual({
      light: { finished: 3, succeeded: 2 },
      heavy: { finished: 1, succeeded: 0 },
    });
    expect(j.now).toEqual({
      light: { running: 0, queued: 1 },
      heavy: { running: 1, queued: 0 },
    });
    expect(j.per_day.at(-1)).toMatchObject({
      succeeded: 2,
      failed: 1,
      timed_out: 1,
    });

    const echo = j.by_kind.find((k) => k.kind === "test.echo");
    expect(echo).toMatchObject({ runs: 4, succeeded: 2, failed: 1 });
    expect(echo?.avg_seconds).toBeCloseTo(14, 5);
    expect(j.by_kind.find((k) => k.kind === "test.slow")).toMatchObject({
      runs: 2,
      failed: 1,
      avg_seconds: 60,
    });
  });

  it("lists the next day's firings of each scheduled definition", async () => {
    await createJobDefinition(
      { kind: "test.echo", name: "hourly", schedule: "0 * * * *" },
      null,
    );
    await createJobDefinition(
      { kind: "test.echo", name: "daily", schedule: "30 3 * * *" },
      null,
    );
    await createJobDefinition({ kind: "test.echo", name: "by hand" }, null);
    await createJobDefinition(
      { kind: "test.echo", name: "off", schedule: "0 * * * *", enabled: false },
      null,
    );

    const now = new Date("2026-09-18T10:15:00Z");
    const j = await jobCensus(14, now);
    expect(j.definitions).toEqual({
      total: 4,
      enabled: 3,
      scheduled: 2,
      manual: 1,
      disabled: 1,
    });
    expect(j.upcoming.map((u) => u.name)).toEqual(["daily", "hourly"]);
    expect(j.upcoming.find((u) => u.name === "hourly")?.at).toHaveLength(24);
    expect(j.upcoming.find((u) => u.name === "daily")?.at).toEqual([
      "2026-09-19T03:30:00.000Z",
    ]);
  });

  it("names the definitions whose last finished run failed", async () => {
    const good = await createJobDefinition(
      { kind: "test.echo", name: "recovered" },
      null,
    );
    const bad = await createJobDefinition(
      { kind: "test.echo", name: "broken" },
      null,
    );
    await run({
      status: "failed",
      definitionId: good.id,
      createdMinutesAgo: 30,
    });
    await run({
      status: "succeeded",
      definitionId: good.id,
      createdMinutesAgo: 10,
    });
    await run({
      status: "succeeded",
      definitionId: bad.id,
      createdMinutesAgo: 30,
    });
    await run({
      status: "timed_out",
      definitionId: bad.id,
      createdMinutesAgo: 10,
    });
    await run({ status: "queued", definitionId: bad.id, createdMinutesAgo: 1 });
    await run({ status: "queued", kind: "test.slow", createdMinutesAgo: 40 });

    const issues = await jobIssues();
    expect(issues["jobs.failing"]).toEqual({
      n: 1,
      items: [{ key: bad.id, label: "broken" }],
    });
    expect(issues["jobs.stuck"]).toMatchObject({
      n: 1,
      items: [{ label: "test.slow" }],
    });
    expect(issues["jobs.disabled"]).toEqual({ n: 0, items: [] });
  });
});

describe("a database whose schema is behind", () => {
  it("waits for the job tables instead of taking the process down", async () => {
    const schema = process.env.TEST_SCHEMA ?? "public";
    await sql.unsafe(`alter table job_runs rename to job_runs_hidden`);
    try {
      const started = startJobProcess({
        classes: ["light"],
        concurrency: 1,
        waitMs: 200,
      });
      // Still waiting after the table is gone, rather than rejecting.
      const raced = await Promise.race([
        started.then(() => "started"),
        new Promise((r) => setTimeout(() => r("waiting"), 600)),
      ]);
      expect(raced).toBe("waiting");
      await sql.unsafe(`alter table job_runs_hidden rename to job_runs`);
      const worker = await started;
      await worker.drain(500);
      expect(schema).toBeTruthy();
    } finally {
      await sql`select 1`;
      const [row] =
        await sql`select to_regclass('job_runs_hidden') is not null as hidden`;
      if (row.hidden)
        await sql.unsafe(`alter table job_runs_hidden rename to job_runs`);
    }
  }, 20_000);
});
