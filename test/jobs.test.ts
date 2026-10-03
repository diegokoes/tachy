import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  cancelRun,
  claimRun,
  inFlightRun,
  jobLive,
  listJobRuns,
  pruneWorkers,
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
  kind: "test.index",
  title: "Holds the index queue until stopped",
  params: z.object({ key: z.string() }),
  queue: "index",
  dedupeKey: (p) => p.key,
  timeout: "1m",
  run: (ctx) =>
    new Promise((resolve) =>
      ctx.signal.addEventListener("abort", () => resolve(undefined)),
    ),
});
defineJob({
  kind: "test.fanout",
  title: "Queues two echoes",
  params: z.object({}),
  timeout: "1m",
  run: async (ctx) => {
    await ctx.enqueue("test.echo", { word: "one" });
    await ctx.enqueue("test.echo", { word: "two" });
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
  queue: "embed",
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

describe("queues", () => {
  it("hands back the run already holding a dedupe key, and frees the key when it ends", async () => {
    const first = await enqueueRun({
      kind: "test.index",
      params: { key: "a" },
      trigger: "manual",
    });
    expect(
      await Promise.all([
        enqueueRun({
          kind: "test.index",
          params: { key: "a" },
          trigger: "manual",
        }),
        enqueueRun({
          kind: "test.index",
          params: { key: "a" },
          trigger: "event",
        }),
      ]),
    ).toEqual([null, null]);
    expect(await inFlightRun("test.index", { key: "a" })).toBe(first);
    expect(
      await enqueueRun({
        kind: "test.index",
        params: { key: "b" },
        trigger: "manual",
      }),
    ).not.toBeNull();

    await cancelRun(first!);
    expect(await inFlightRun("test.index", { key: "a" })).toBeNull();
    expect(
      await enqueueRun({
        kind: "test.index",
        params: { key: "a" },
        trigger: "manual",
      }),
    ).not.toBeNull();
  });

  it("never runs more of a queue than its cap, even when workers claim at once", async () => {
    for (const key of ["a", "b"])
      await enqueueRun({
        kind: "test.index",
        params: { key },
        trigger: "manual",
      });
    const slow = await enqueueRun({
      kind: "test.slow",
      params: {},
      trigger: "manual",
    });
    const claimed = await Promise.all([
      claimRun(["heavy"], "w1", 60_000),
      claimRun(["heavy"], "w2", 60_000),
      claimRun(["heavy"], "w3", 60_000),
    ]);
    const kinds = claimed.map((r) => r?.kind ?? null).sort();
    expect(kinds).toEqual([null, "test.index", "test.slow"]);

    const index = claimed.find((r) => r?.kind === "test.index")!;
    await finishRun(index.id, index.locked_by!, {
      status: "succeeded",
      logTail: "",
    });
    expect((await claimRun(["heavy"], "w1", 60_000))?.kind).toBe("test.index");
    expect(slow).not.toBeNull();
  });

  it("claims by priority before age, and a worker can keep to named queues", async () => {
    const scheduled = await enqueueRun({
      kind: "test.echo",
      params: {},
      trigger: "schedule",
    });
    const clicked = await enqueueRun({
      kind: "test.echo",
      params: {},
      trigger: "manual",
    });
    const indexing = await enqueueRun({
      kind: "test.index",
      params: { key: "a" },
      trigger: "manual",
    });

    expect(await claimRun(["heavy"], "w", 60_000, ["embed"])).toBeNull();
    expect((await claimRun(["heavy"], "w", 60_000, ["index"]))?.id).toBe(
      indexing,
    );
    expect((await claimRun(["light"], "w", 60_000))?.id).toBe(clicked);
    expect((await claimRun(["light"], "w", 60_000))?.id).toBe(scheduled);
  });

  it("links the runs a run queues to it, at its priority, and sums them up", async () => {
    const worker = await startJobWorker({
      classes: ["light"],
      concurrency: 1,
      pollMs: 100,
      scheduleMs: 60_000,
    });
    try {
      const parent = (await enqueueRun({
        kind: "test.fanout",
        params: {},
        trigger: "manual",
      }))!;
      let listed = await listJobRuns({ parentId: parent });
      for (
        let i = 0;
        i < 50 &&
        (listed.length < 2 || listed.some((r) => r.status !== "succeeded"));
        i++
      ) {
        await new Promise((r) => setTimeout(r, 100));
        listed = await listJobRuns({ parentId: parent });
      }
      expect(
        listed.map((r) => [r.kind, r.trigger, r.priority, r.status]),
      ).toEqual([
        ["test.echo", "event", 10, "succeeded"],
        ["test.echo", "event", 10, "succeeded"],
      ]);
      const [row] = (await listJobRuns({})).filter((r) => r.id === parent);
      expect(row.children).toEqual({
        total: 2,
        queued: 0,
        running: 0,
        succeeded: 2,
        failed: 0,
      });
      expect(listed[0].children).toBeNull();
    } finally {
      await worker.drain(1_000);
    }
  });

  it("keeps a slot for light runs while a heavy one holds the other", async () => {
    const worker = await startJobWorker({
      classes: ["light", "heavy"],
      concurrency: 2,
      perClass: { light: 1, heavy: 1 },
      pollMs: 100,
      scheduleMs: 60_000,
    });
    try {
      const index = (await enqueueRun({
        kind: "test.index",
        params: { key: "a" },
        trigger: "manual",
      }))!;
      await enqueueRun({ kind: "test.slow", params: {}, trigger: "manual" });
      const echo = (await enqueueRun({
        kind: "test.echo",
        params: {},
        trigger: "manual",
      }))!;
      let run = await getJobRun(echo);
      for (let i = 0; i < 50 && run.status !== "succeeded"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        run = await getJobRun(echo);
      }
      expect(run.status).toBe("succeeded");
      const heavy = await sql`
        select kind from job_runs where resource_class = 'heavy' and status = 'running'
      `;
      expect(heavy).toHaveLength(1);
      await cancelRun(index);
    } finally {
      await worker.drain(1_000);
    }
  });
});

describe("the worker roster", () => {
  it("lists a live worker with its queues and the run it holds, and forgets it on drain", async () => {
    const worker = await startJobWorker({
      classes: ["heavy"],
      concurrency: 1,
      pollMs: 100,
      scheduleMs: 60_000,
    });
    try {
      const id = (await enqueueRun({
        kind: "test.index",
        params: { key: "a" },
        trigger: "manual",
      }))!;
      await enqueueRun({ kind: "test.slow", params: {}, trigger: "manual" });
      let live = await jobLive();
      for (let i = 0; i < 50 && !live.workers[0]?.runs.length; i++) {
        await new Promise((r) => setTimeout(r, 100));
        live = await jobLive();
      }
      expect(live.workers).toHaveLength(1);
      expect(live.workers[0]).toMatchObject({
        classes: ["heavy"],
        queues: ["index", "embed", "testing"],
        concurrency: 1,
        alive: true,
        draining: false,
        runs: [{ id, kind: "test.index", queue: "index" }],
      });
      const byName = Object.fromEntries(live.queues.map((q) => [q.name, q]));
      expect(byName.index).toMatchObject({
        running: 1,
        queued: 0,
        workers: 1,
        slots: 1,
      });
      expect(byName.embed).toMatchObject({ running: 0, queued: 1, workers: 1 });
      expect(byName.sync).toMatchObject({ workers: 0, slots: 0 });
      await cancelRun(id);
    } finally {
      await worker.drain(1_000);
    }
    expect((await jobLive()).workers).toEqual([]);
  });

  it("marks a silent worker gone, prunes it later, and flags queues nobody serves", async () => {
    await sql`
      insert into job_workers (id, host, pid, classes, queues, concurrency, last_seen_at)
      values ('quiet', 'h', 1, '{light}', '{sync,maintenance}', 2, now() - interval '5 minutes'),
             ('dead', 'h', 2, '{heavy}', '{index}', 1, now() - interval '1 hour')
    `;
    await enqueueRun({ kind: "test.echo", params: {}, trigger: "manual" });
    const live = await jobLive();
    expect(live.workers.map((w) => [w.id, w.alive])).toEqual([
      ["dead", false],
      ["quiet", false],
    ]);
    expect(live.queues.find((q) => q.name === "maintenance")).toMatchObject({
      queued: 1,
      workers: 0,
    });
    expect((await jobIssues())["jobs.no_worker"]).toEqual({
      n: 1,
      items: [{ key: "maintenance", label: "maintenance (1 queued)" }],
    });
    expect(await pruneWorkers()).toBe(1);
    expect((await jobLive()).workers.map((w) => w.id)).toEqual(["quiet"]);
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

    expect(j.by_queue.map((q) => q.queue)).toEqual([
      "index",
      "embed",
      "testing",
      "sync",
      "flows",
      "maintenance",
    ]);
    expect(j.by_queue.every((q) => q.started === 0)).toBe(true);

    const echo = j.by_kind.find((k) => k.kind === "test.echo");
    expect(echo).toMatchObject({ runs: 4, succeeded: 2, failed: 1 });
    expect(echo?.avg_seconds).toBeCloseTo(14, 5);
    expect(j.by_kind.find((k) => k.kind === "test.slow")).toMatchObject({
      runs: 2,
      failed: 1,
      avg_seconds: 60,
    });
  });

  it("averages how long runs waited in each queue before starting", async () => {
    await sql`
      insert into job_runs (kind, resource_class, queue, trigger, status, timeout_ms,
                            created_at, started_at, finished_at)
      values ('test.echo', 'light', 'maintenance', 'manual', 'succeeded', 60000,
              now() - interval '10 minutes', now() - interval '9 minutes', now()),
             ('test.echo', 'light', 'maintenance', 'manual', 'succeeded', 60000,
              now() - interval '10 minutes', now() - interval '7 minutes', now()),
             ('test.echo', 'light', 'maintenance', 'manual', 'queued', 60000,
              now() - interval '10 minutes', null, null)
    `;
    const j = await jobCensus(14);
    expect(j.by_queue.find((q) => q.queue === "maintenance")).toEqual({
      queue: "maintenance",
      started: 2,
      avg_wait_seconds: 120,
      max_wait_seconds: 180,
    });
    expect(j.by_queue.find((q) => q.queue === "index")?.started).toBe(0);
  });

  /* The light and heavy counters on the overview are jobs, not runs. A
     definition with no class of its own runs on its kind's default, which
     lives in code, so this is the one count the SQL alone cannot make. */
  it("counts definitions per pool by the class each actually runs on", async () => {
    await createJobDefinition(
      { kind: "test.echo", name: "light by kind" },
      null,
    );
    await createJobDefinition(
      { kind: "test.slow", name: "heavy by kind" },
      null,
    );
    await createJobDefinition(
      { kind: "test.echo", name: "moved to heavy", queue: "index" },
      null,
    );

    const j = await jobCensus(14);
    expect(j.definitions.by_class).toEqual({ light: 1, heavy: 2 });
  });

  /* What the failed counter opens: which jobs failed, not a count of runs. */
  it("groups failed and timed-out runs by the job they belong to", async () => {
    const nightly = await createJobDefinition(
      { kind: "test.echo", name: "nightly" },
      null,
    );
    await run({
      status: "failed",
      definitionId: nightly.id,
      createdMinutesAgo: 30,
    });
    await run({
      status: "timed_out",
      definitionId: nightly.id,
      createdMinutesAgo: 10,
    });
    await run({ status: "succeeded", definitionId: nightly.id });
    await run({ kind: "test.slow", cls: "heavy", status: "failed" });
    await run({ status: "failed", createdMinutesAgo: 60 * 24 * 20 });

    const j = await jobCensus(14);
    expect(j.failures.map((f) => [f.name, f.runs])).toEqual([
      ["nightly", 2],
      ["test.slow", 1],
    ]);
    expect(j.failures[0].definition_id).toBe(nightly.id);
    // An ad-hoc run has no definition, so it is named by its kind.
    expect(j.failures[1].definition_id).toBeNull();
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
      by_class: { light: 4, heavy: 0 },
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
