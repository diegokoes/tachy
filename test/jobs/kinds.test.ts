import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core/access";
import {
  deleteJobDefinition,
  describeJobKinds,
  enqueueRun,
  ensureDefaultDefinitions,
  genericOutcome,
  getJobKind,
  listJobDefinitions,
  presentRun,
  registerCoreJobs,
} from "@tachy/core/jobs";
import { linkRepo } from "@tachy/core/code";
import {
  rollUpUsage,
  sweepOrphanAssets,
  sweepTranscripts,
} from "@tachy/core/compliance";
import { saveAsset } from "@tachy/core/library";
import { sweepFlowRuns } from "@tachy/core/flows";
import { sweepNotifications } from "@tachy/core/notifications";
import { resetData, sql, resetJobs } from "../database";

afterAll(() => sql.end());

registerCoreJobs();

beforeEach(async () => {
  await resetData();
  await resetJobs();
});

describe("core job kinds", () => {
  it("registers the first kinds with their queues and classes", () => {
    const kinds = Object.fromEntries(
      describeJobKinds().map((k) => [k.kind, `${k.queue}/${k.resource_class}`]),
    );
    expect(kinds).toMatchObject({
      "repo.reindex": "index/heavy",
      "repos.refresh": "maintenance/light",
      "source.sync": "sync/light",
      "embeddings.backfill": "embed/heavy",
      "load.test": "testing/heavy",
      "retention.sweep": "maintenance/light",
      "wiki.gaps": "maintenance/light",
      "bucket.embed": "embed/heavy",
    });
  });

  it("creates default schedules once, and never brings back a deleted one", async () => {
    expect(await ensureDefaultDefinitions()).toHaveLength(3);
    expect(await ensureDefaultDefinitions()).toEqual([]);
    const defs = await listJobDefinitions();
    expect(defs.map((d) => [d.kind, d.schedule]).sort()).toEqual([
      ["repos.refresh", "40 2 * * *"],
      ["retention.sweep", "30 3 * * *"],
      ["wiki.gaps", "7 * * * *"],
    ]);
    await deleteJobDefinition(
      defs.find((d) => d.kind === "wiki.gaps")!.id,
      null,
    );
    expect(await ensureDefaultDefinitions()).toEqual([]);
  });
});

const refreshCtx = () => ({
  runId: "test",
  requestedBy: null,
  signal: new AbortController().signal,
  progress: async () => {},
  log: () => {},
  credential: async () => undefined,
  enqueue: (kind: string, params: unknown) =>
    enqueueRun({ kind, params, trigger: "event" }),
});

describe("repos.refresh", () => {
  it("takes repos never indexed too when asked for all of them", async () => {
    await linkRepo({ slug: "new", url: "https://example.invalid/new.git" });
    await linkRepo({ slug: "old", url: "https://example.invalid/old.git" });
    await sql`
      update repo_lines set indexed_commit = repeat('a', 40)
      where repo_id in (select id from repos where slug = 'old')
    `;
    const kind = getJobKind("repos.refresh");
    const output = await kind.run(
      refreshCtx(),
      kind.params.parse({ scope: "all" }),
    );
    expect(output).toEqual({ queued: 2, skipped: 0, never_indexed: 0 });
  });

  it("queues a reindex of each indexed repo that is not already in flight", async () => {
    await linkRepo({ slug: "busy", url: "https://example.invalid/busy.git" });
    await linkRepo({ slug: "stale", url: "https://example.invalid/stale.git" });
    await linkRepo({ slug: "fresh", url: "https://example.invalid/fresh.git" });
    await sql`
      update repo_lines set indexed_commit = repeat('a', 40)
      where repo_id in (select id from repos where slug in ('busy', 'stale'))
    `;
    await enqueueRun({
      kind: "repo.reindex",
      params: { repo: "busy" },
      trigger: "manual",
    });
    const output = await getJobKind("repos.refresh").run(
      {
        runId: "test",
        requestedBy: null,
        signal: new AbortController().signal,
        progress: async () => {},
        log: () => {},
        credential: async () => undefined,
        enqueue: (kind, params) =>
          enqueueRun({ kind, params, trigger: "event" }),
      },
      {},
    );
    expect(output).toEqual({ queued: 1, skipped: 1, never_indexed: 1 });
    const runs = await sql`
      select params->>'repo' as repo from job_runs
      where kind = 'repo.reindex' order by repo
    `;
    expect(runs.map((r) => r.repo)).toEqual(["busy", "stale"]);
  });
});

describe("retention", () => {
  it("rolls old per-person usage up to months without people", async () => {
    const user = await createUser({ email: "reader@example.com" });
    const [entry] =
      await sql`insert into knowledge_entries (status, issue_summary) values ('approved', 'x') returning id`;
    await sql`
      insert into library_views (knowledge_entry_id, user_id, day, views) values
        (${entry.id}, ${user.id}, date_trunc('month', current_date) - interval '15 months', 2),
        (${entry.id}, null, date_trunc('month', current_date) - interval '15 months' + interval '1 day', 3),
        (${entry.id}, ${user.id}, current_date, 1)
    `;
    await sql`
      insert into mcp_tool_calls (tool, writes, user_id, day, calls) values
        ('search_knowledge', false, ${user.id}, current_date - interval '14 months', 4),
        ('search_knowledge', false, ${user.id}, current_date, 1)
    `;
    const rolled = await rollUpUsage(13);
    expect(rolled).toEqual({ views: 2, toolCalls: 1 });
    const views =
      await sql`select user_id, views, day = date_trunc('month', day)::date as monthly from library_views order by day`;
    expect(views.map((v) => [v.user_id, v.views, v.monthly])).toEqual([
      [null, 5, true],
      [user.id, 1, views[1].monthly],
    ]);
    expect(await rollUpUsage(13)).toEqual({ views: 0, toolCalls: 0 });
    const calls =
      await sql`select user_id, calls from mcp_tool_calls order by day`;
    expect(calls.map((c) => [c.user_id, c.calls])).toEqual([
      [null, 4],
      [user.id, 1],
    ]);
  });

  it("deletes flow runs after 90 days, failed ones after 180, and never a running one", async () => {
    const [flow] =
      await sql`insert into flows (name) values ('f') returning id`;
    const run = (status: string, days: number) =>
      sql`insert into flow_runs (flow_id, status, started_at, finished_at)
          values (${flow.id}, ${status}, now() - make_interval(days => ${days}),
                  ${status === "running" ? null : sql`now() - make_interval(days => ${days})`})`;
    await run("succeeded", 91);
    await run("succeeded", 89);
    await run("failed", 91);
    await run("failed", 181);
    await run("running", 200);
    expect(await sweepFlowRuns()).toBe(2);
    const left = await sql`select status from flow_runs order by started_at`;
    expect(left.map((r) => r.status)).toEqual([
      "running",
      "failed",
      "succeeded",
    ]);
  });

  it("deletes notifications 90 days after they were opened, 180 if never", async () => {
    const user = await createUser({ email: "notified@example.com" });
    const note = (title: string, days: number, read: boolean) =>
      sql`insert into notifications (user_id, kind, title, created_at, read_at)
          values (${user.id}, 'report_reply', ${title}, now() - make_interval(days => ${days}),
                  ${read ? sql`now()` : null})`;
    await note("read, old", 91, true);
    await note("read, recent", 89, true);
    await note("unread, old", 91, false);
    await note("unread, very old", 181, false);
    expect(await sweepNotifications()).toBe(2);
    const left = await sql`select title from notifications order by created_at`;
    expect(left.map((r) => r.title)).toEqual(["unread, old", "read, recent"]);
  });

  it("deletes transcripts past their age and keeps recent ones", async () => {
    const home = await mkdtemp(join(tmpdir(), "tachy-agent-"));
    process.env.TACHY_AGENT_HOME = home;
    const dir = join(home, "users", "u1", "projects", "app");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "old.jsonl"), "{}");
    await writeFile(join(dir, "new.jsonl"), "{}");
    const old = new Date(Date.now() - 91 * 86_400_000);
    await utimes(join(dir, "old.jsonl"), old, old);
    try {
      expect(await sweepTranscripts(90)).toBe(1);
      expect(await readdir(dir)).toEqual(["new.jsonl"]);
    } finally {
      delete process.env.TACHY_AGENT_HOME;
    }
  });

  it("removes week-old images nothing references", async () => {
    const png = (seed: number) =>
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
    const kept = await saveAsset({ bytes: png(1), filename: "kept.png" });
    const orphan = await saveAsset({ bytes: png(2), filename: "orphan.png" });
    await sql`update library_assets set created_at = now() - interval '8 days'`;
    await sql`
      insert into reference_docs (title, body, kind, status)
      values ('uses an image', ${`![x](/api/library/assets/${kept.id})`}, 'wiki', 'approved')
    `;
    expect(await sweepOrphanAssets()).toBe(1);
    const left = await sql`select id from library_assets`;
    expect(left.map((r) => r.id)).toEqual([kept.id]);
    expect(orphan.id).not.toBe(kept.id);
  });
});

describe("how kinds present their runs", () => {
  const line = (over: Record<string, unknown>) => ({
    ref: "master",
    upToDate: false,
    filesIndexed: 2507,
    filesEmbedded: 2499,
    filesDeleted: 0,
    versionLabel: "v1.51.46",
    ...over,
  });

  it("names a repository run by its repo, line and fullness", () => {
    expect(presentRun("repo.reindex", { repo: "portal" }, null).subject).toBe(
      "portal",
    );
    expect(
      presentRun(
        "repo.reindex",
        { repo: "portal", line: "dev", full: true },
        null,
      ).subject,
    ).toBe("portal @ dev (full)");
  });

  it("says what an index did instead of printing its lines", () => {
    const said = (lines: unknown[]) =>
      presentRun("repo.reindex", { repo: "r" }, { lines }).outcome;
    expect(said([line({})])).toBe("2,507 files indexed, 2,499 embedded");
    expect(said([line({ upToDate: true })])).toBe("up to date at v1.51.46");
    expect(
      said([line({ filesIndexed: 1, filesEmbedded: 0, filesDeleted: 3 })]),
    ).toBe("1 file indexed, 3 removed");
    expect(
      said([line({ upToDate: true }), line({ ref: "dev", filesIndexed: 4 })]),
    ).toBe(
      "master: up to date at v1.51.46 · dev: 4 files indexed, 2,499 embedded",
    );
    expect(said([])).toBeNull();
  });

  it("sums up a fan-out, a gap sweep and a source sync", () => {
    expect(
      presentRun(
        "repos.refresh",
        { scope: "all" },
        {
          queued: 4,
          skipped: 1,
          never_indexed: 0,
        },
      ).outcome,
    ).toBe("4 repositories queued, 1 already running");
    expect(
      presentRun("wiki.gaps", {}, { gaps: 0, wikis: 5, failed: 0, skipped: 0 })
        .outcome,
    ).toBe("no gaps in 5 wikis");
    expect(
      presentRun("wiki.gaps", {}, { gaps: 3, wikis: 1, failed: 1, skipped: 0 })
        .outcome,
    ).toBe("3 gaps in 1 wiki, 1 failed");
    expect(
      presentRun("source.sync", { connection: "fd" }, { total: 12 }),
    ).toEqual({ subject: "fd", outcome: "12 items pulled" });
  });

  it("totals what the sweeps and backfills removed or embedded", () => {
    expect(
      presentRun("retention.sweep", {}, { outputs: 2, uploads: 0, usage: 3 })
        .outcome,
    ).toBe("5 items removed");
    expect(presentRun("retention.sweep", {}, { outputs: 0 }).outcome).toBe(
      "nothing to remove",
    );
    expect(
      presentRun("embeddings.backfill", { all: true }, { entries: 1, code: 2 }),
    ).toEqual({ subject: "everything", outcome: "3 vectors embedded" });
    expect(
      presentRun("bucket.embed", { bucket_id: "b" }, { chunks: 1 }).outcome,
    ).toBe("1 chunk embedded");
  });

  it("reports what a flow pass queued or why it skipped", () => {
    const flow = (o: Record<string, unknown>) =>
      presentRun("flow.run", { dry_run: false }, o).outcome;
    expect(flow({ skipped: "the flow is paused" })).toBe(
      "skipped: the flow is paused",
    );
    expect(flow({ matched: 5, queued: 3 })).toBe("3 of 5 items queued");
    expect(flow({ flow_run_id: "x", status: "succeeded" })).toBe("succeeded");
  });

  it("falls back to the numbers in the output for a kind with no words of its own", () => {
    expect(
      genericOutcome({ rows_kept: 4, dropped: 0, note: "ok", dry: true }),
    ).toBe("4 rows kept, note ok, dry");
    expect(genericOutcome({ nothing: 0 })).toBeNull();
    expect(presentRun("load.test", {}, { total_checks: 9 }).outcome).toBe(
      "9 total checks",
    );
  });

  it("presents nothing for a kind that is gone, and survives a throwing presenter", () => {
    expect(presentRun("removed.kind", { a: 1 }, { b: 2 })).toEqual({
      subject: null,
      outcome: null,
    });
    expect(
      presentRun("repo.reindex", { repo: "r" }, { lines: [null] }).outcome,
    ).toBeNull();
  });
});
