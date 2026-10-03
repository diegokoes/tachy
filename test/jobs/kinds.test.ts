import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  deleteJobDefinition,
  describeJobKinds,
  enqueueRun,
  ensureDefaultDefinitions,
  getJobKind,
  linkRepo,
  listJobDefinitions,
  registerCoreJobs,
  rollUpUsage,
  saveAsset,
  sweepOrphanAssets,
  sweepTranscripts,
} from "@tachy/core";
import { resetData, sql, resetJobs } from "../helpers";

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
    const out = await kind.run(
      refreshCtx(),
      kind.params.parse({ scope: "all" }),
    );
    expect(out).toEqual({ queued: 2, skipped: 0, never_indexed: 0 });
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
    const out = await getJobKind("repos.refresh").run(
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
    expect(out).toEqual({ queued: 1, skipped: 1, never_indexed: 1 });
    const runs = await sql`
      select params->>'repo' as repo from job_runs
      where kind = 'repo.reindex' order by repo
    `;
    expect(runs.map((r) => r.repo)).toEqual(["busy", "stale"]);
  });
});

describe("retention", () => {
  it("rolls old per-person usage up to months without people", async () => {
    const u = await createUser({ email: "reader@example.com" });
    const [e] =
      await sql`insert into knowledge_entries (status, issue_summary) values ('approved', 'x') returning id`;
    await sql`
      insert into library_views (knowledge_entry_id, user_id, day, views) values
        (${e.id}, ${u.id}, date_trunc('month', current_date) - interval '15 months', 2),
        (${e.id}, null, date_trunc('month', current_date) - interval '15 months' + interval '1 day', 3),
        (${e.id}, ${u.id}, current_date, 1)
    `;
    await sql`
      insert into mcp_tool_calls (tool, writes, user_id, day, calls) values
        ('search_knowledge', false, ${u.id}, current_date - interval '14 months', 4),
        ('search_knowledge', false, ${u.id}, current_date, 1)
    `;
    const r = await rollUpUsage(13);
    expect(r).toEqual({ views: 2, toolCalls: 1 });
    const views =
      await sql`select user_id, views, day = date_trunc('month', day)::date as monthly from library_views order by day`;
    expect(views.map((v) => [v.user_id, v.views, v.monthly])).toEqual([
      [null, 5, true],
      [u.id, 1, views[1].monthly],
    ]);
    expect(await rollUpUsage(13)).toEqual({ views: 0, toolCalls: 0 });
    const calls =
      await sql`select user_id, calls from mcp_tool_calls order by day`;
    expect(calls.map((c) => [c.user_id, c.calls])).toEqual([
      [null, 4],
      [u.id, 1],
    ]);
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
