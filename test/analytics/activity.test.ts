import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  addFeedback,
  knowledgeStale,
  saveKnowledgeEntry,
} from "@tachy/core/knowledge";
import { bucketFreshness, createBucket } from "@tachy/core/buckets";
import { repoFreshness } from "@tachy/core/code";
import {
  agentUsageCensus,
  recordRun,
  recordToolCall,
  toolUsageCensus,
} from "@tachy/core/analytics";
import { createUser } from "@tachy/core/access";
import { libraryEngagementCensus, recordView } from "@tachy/core/library";
import {
  recordSourceCall,
  setSourceOrigin,
  sourceFetch,
  sourceFreshness,
  sourceTrafficCensus,
} from "@tachy/core/sources";
import { resetData, sql, tpdProductId } from "../database";

/*
 * The overviews' activity figures. Each aggregate is asserted from empty, so a
 * fresh deployment renders zeros rather than an error, and from a few seeded
 * rows, so the day buckets and the splits add up.
 */
describe("overview activity", () => {
  beforeEach(resetData);
  afterEach(() => setSourceOrigin("app"));
  afterAll(() => sql.end());

  describe("agent usage", () => {
    it("is all zeroes with a filled run of days when nothing has run", async () => {
      const u = await agentUsageCensus(30);
      expect(u).toMatchObject({ turns: 0, input_tokens: 0, output_tokens: 0 });
      expect(u.per_day).toHaveLength(30);
      expect(u.per_day.every((d) => d.tokens === 0)).toBe(true);
      expect(u.per_day.every((d) => Object.keys(d.models).length === 0)).toBe(
        true,
      );
    });

    it("sums chat turns only, and ranks people by tokens", async () => {
      const heavy = await createUser({ email: "heavy@test.local" });
      const light = await createUser({ email: "light@test.local" });
      await recordRun({
        mode: "chat",
        userId: heavy.id,
        model: "claude-sonnet-5",
        inputTokens: 1000,
        outputTokens: 500,
        meta: { cost_usd: 0.5 },
      });
      await recordRun({
        mode: "chat",
        userId: light.id,
        model: "claude-haiku-4-5",
        inputTokens: 100,
        outputTokens: 50,
      });
      /* What fetch_work_item writes: a run with no tokens, which is not a turn. */
      await recordRun({ mode: "consult", userId: heavy.id });

      const u = await agentUsageCensus(30);
      expect(u.turns).toBe(2);
      expect(u.input_tokens).toBe(1100);
      expect(u.output_tokens).toBe(550);
      expect(u.active).toBe(2);
      expect(u.cost_usd).toBeGreaterThan(0.5);
      expect(u.per_day.at(-1)?.turns).toBe(2);
      expect(u.per_day.at(-1)?.models).toEqual({
        "claude-sonnet-5": 1500,
        "claude-haiku-4-5": 150,
      });
      expect(u.by_model.map((m) => m.model)).toEqual([
        "claude-sonnet-5",
        "claude-haiku-4-5",
      ]);
      expect(u.top_users?.[0]).toMatchObject({
        email: "heavy@test.local",
        turns: 1,
        tokens: 1500,
      });
    });

    /* The Claude backend records cost_usd: 0 when its SDK reports nothing. That
       zero is "unknown", and has to be priced rather than summed as free. */
    it("prices tokens whose reported cost is zero", async () => {
      await recordRun({
        mode: "chat",
        model: "claude-sonnet-5",
        inputTokens: 1_000_000,
        outputTokens: 0,
        meta: { cost_usd: 0 },
      });
      const u = await agentUsageCensus(30);
      expect(u.cost_usd).toBeCloseTo(3, 6);
    });

    it("counts what flows spent apart from turns, the costliest flow first", async () => {
      const [cheap] =
        await sql`insert into flows (name) values ('cheap') returning id`;
      const [dear] =
        await sql`insert into flows (name) values ('dear') returning id`;
      const ask = (flowId: string, inputTokens: number) =>
        recordRun({
          mode: "flow",
          model: "claude-sonnet-5",
          inputTokens,
          outputTokens: 0,
          meta: { flow_id: flowId },
        });
      await ask(cheap.id, 1_000);
      await ask(dear.id, 1_000_000);
      await ask(dear.id, 1_000_000);
      await ask("00000000-0000-4000-8000-000000000000", 500);
      await recordRun({ mode: "chat", model: "claude-sonnet-5" });

      const u = await agentUsageCensus(30);
      expect(u.turns).toBe(1);
      expect(u.flows.calls).toBe(4);
      expect(u.flows.tokens).toBe(2_001_500);
      expect(u.flows.cost_usd).toBeCloseTo(6.0045, 4);
      expect(u.flows.by_flow.map((f) => [f.name, f.calls])).toEqual([
        ["dear", 2],
        ["cheap", 1],
        ["(deleted flow)", 1],
      ]);
    });
  });

  describe("tool use", () => {
    it("buckets per tool, person and day and splits reads from writes", async () => {
      const user = await createUser({ email: "writer@test.local" });
      await recordToolCall("search_knowledge", false, user.id, {
        ok: true,
        misuse: false,
      });
      await recordToolCall("search_knowledge", false, user.id, {
        ok: true,
        misuse: false,
      });
      await recordToolCall("save_knowledge_entry", true, user.id, {
        ok: false,
        misuse: true,
      });

      const [bucket] = await sql`
        select calls from mcp_tool_calls where tool = 'search_knowledge'
      `;
      expect(bucket.calls).toBe(2);

      const t = await toolUsageCensus(30);
      expect(t.reads).toBe(2);
      expect(t.writes).toBe(1);
      expect(t.tools[0]).toMatchObject({ tool: "search_knowledge", calls: 2 });
      expect(
        t.tools.find((x) => x.tool === "save_knowledge_entry"),
      ).toMatchObject({ failures: 1, misuse: 1 });
      expect(t.writers).toEqual([{ email: "writer@test.local", writes: 1 }]);
      expect(t.per_day).toHaveLength(30);
      expect(t.per_day.at(-1)).toMatchObject({ reads: 2, writes: 1 });
      expect(
        t.per_day.slice(0, -1).every((d) => d.reads + d.writes === 0),
      ).toBe(true);
    });

    it("still buckets calls nobody can be attributed to", async () => {
      await recordToolCall("list_products", false, null, {
        ok: true,
        misuse: false,
      });
      await recordToolCall("list_products", false, null, {
        ok: true,
        misuse: false,
      });
      const rows = await sql`select calls from mcp_tool_calls`;
      expect(rows).toHaveLength(1);
      expect(rows[0].calls).toBe(2);
    });
  });

  describe("source traffic", () => {
    it("splits a connection's calls by who spent them", async () => {
      setSourceOrigin("agent");
      await recordSourceCall("test-freshdesk", {
        rateLimited: false,
        authFailed: false,
      });
      setSourceOrigin("sync");
      await recordSourceCall("test-freshdesk", {
        rateLimited: true,
        authFailed: false,
      });
      await recordSourceCall("test-freshdesk", {
        rateLimited: false,
        authFailed: true,
      });

      const t = await sourceTrafficCensus(14);
      expect(t.per_day).toHaveLength(14);
      expect(t.per_day.at(-1)).toMatchObject({
        agent: 1,
        sync: 2,
        app: 0,
        rate_limited: 1,
        auth_failures: 1,
      });
      expect(t.connections).toHaveLength(1);
      expect(t.connections[0]).toMatchObject({
        slug: "test-freshdesk",
        agent: 1,
        sync: 2,
        rate_limited: 1,
        auth_failures: 1,
      });
      expect(t.connections[0].last_auth_failure).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("ignores a call against a slug with no connection", async () => {
      await recordSourceCall("nobody-configured-this", {
        rateLimited: false,
        authFailed: false,
      });
      expect((await sourceTrafficCensus(14)).connections).toEqual([]);
    });

    /* One logical call however many retries the rate limiter cost, flagged as
       limited because it was - the retry is invisible to the caller, not to the
       quota. */
    it("counts a retried call once, through sourceFetch", async () => {
      const responses = [
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "0" },
        }),
        new Response("{}", { status: 200 }),
      ];
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => responses.shift()!);
      try {
        const res = await sourceFetch(
          "test",
          "https://example.test/x",
          undefined,
          { connection: "test-freshdesk" },
        );
        expect(res.status).toBe(200);
      } finally {
        fetchMock.mockRestore();
      }

      let rows: { calls: number; rate_limited: number }[] = [];
      for (let i = 0; i < 50 && !rows.length; i++) {
        rows =
          (await sql`select calls, rate_limited from source_calls`) as never;
        if (!rows.length) await new Promise((r) => setTimeout(r, 20));
      }
      expect(rows).toEqual([{ calls: 1, rate_limited: 1 }]);
    });
  });

  describe("library engagement", () => {
    it("ranks what people read and counts corrections", async () => {
      const productId = await tpdProductId();
      const reader = await createUser({ email: "reader@test.local" });
      const read = await saveKnowledgeEntry({
        productId,
        issueSummary: "the popular one",
        resolution: "do the thing",
      });
      const ignored = await saveKnowledgeEntry({
        productId,
        issueSummary: "the ignored one",
        resolution: "do the other thing",
      });
      await recordView({ entryId: read.id }, reader.id);
      await recordView({ entryId: read.id }, null);
      await addFeedback({
        knowledgeEntryId: ignored.id,
        userId: reader.id,
        kind: "correction",
        comment: "step two is wrong",
      });
      await addFeedback({ knowledgeEntryId: read.id, kind: "note" });

      const l = await libraryEngagementCensus(30);
      expect(l.reads).toBe(2);
      expect(l.readers).toBe(1);
      expect(l.corrections).toBe(1);
      expect(l.per_day.at(-1)?.reads).toBe(2);
      expect(l.top).toHaveLength(1);
      expect(l.top[0]).toMatchObject({
        kind: "entry",
        title: "the popular one",
        reads: 2,
      });
    });

    it("splits the day's edits by who made them", async () => {
      const productId = await tpdProductId();
      const person = await createUser({ email: "editor@test.local" });
      await saveKnowledgeEntry({
        productId,
        issueSummary: "typed in the app",
        resolution: "r",
        actor: { actor: "web", userId: person.id },
      });
      await saveKnowledgeEntry({
        productId,
        issueSummary: "saved by the agent",
        resolution: "r",
        actor: { actor: "agent", userId: person.id },
      });
      await saveKnowledgeEntry({
        productId,
        issueSummary: "saved over MCP",
        resolution: "r",
        actor: { actor: "mcp", userId: null },
      });
      await saveKnowledgeEntry({
        productId,
        issueSummary: "ingested",
        resolution: "r",
        actor: { actor: "ingest", userId: null },
      });

      const l = await libraryEngagementCensus(30);
      expect(l.edits_per_day).toHaveLength(30);
      expect(l.edits_per_day.at(-1)).toMatchObject({
        people: 1,
        agent: 2,
        ingest: 1,
      });
      expect(
        l.edits_per_day
          .slice(0, -1)
          .every((d) => d.people + d.agent + d.ingest === 0),
      ).toBe(true);
    });
  });
  describe("freshness", () => {
    it("lists what has never been brought up to date first, then oldest first", async () => {
      await sql`update source_connections set last_synced_at = now() - interval '3 days' where slug = 'test-freshdesk'`;
      await createBucket({ slug: "docs", name: "Docs" }, null);
      await sql`update buckets set last_batch_at = now() - interval '1 hour' where slug = 'docs'`;
      await createBucket({ slug: "stale", name: "Stale docs" }, null);

      const buckets = await bucketFreshness();
      expect(buckets.map((b) => b.key)).toEqual(["stale", "docs"]);
      expect(buckets[0]).toMatchObject({
        kind: "bucket",
        label: "Stale docs",
        last_at: null,
      });

      const sources = await sourceFreshness();
      const synced = sources.find((x) => x.key === "test-freshdesk")!;
      expect(synced).toMatchObject({ kind: "source", label: "test-freshdesk" });
      expect(Date.parse(synced.last_at!)).toBeLessThan(Date.now());
      const nulls = sources.filter((x) => x.last_at === null).length;
      expect(sources.slice(0, nulls).every((x) => x.last_at === null)).toBe(
        true,
      );
      await sql`update source_connections set last_synced_at = null where slug = 'test-freshdesk'`;
      expect(await repoFreshness()).toEqual([]);
    });
  });

  describe("stale knowledge", () => {
    it("counts what waits for review and what nobody has read", async () => {
      const productId = await tpdProductId();
      const reader = await createUser({ email: "rater@test.local" });
      const entry = (summary: string) =>
        saveKnowledgeEntry({
          productId,
          issueSummary: summary,
          resolution: "r",
        });
      const fresh = await entry("fresh draft");
      const old = await entry("old draft");
      const read = await entry("approved and read");
      const idle = await entry("approved and idle");
      await sql`update knowledge_entries set status = 'draft' where id in (${fresh.id}, ${old.id})`;
      await sql`update knowledge_entries set created_at = now() - interval '120 days' where id = ${old.id}`;
      await sql`alter table knowledge_entries disable trigger knowledge_entries_updated_at`;
      await sql`
        update knowledge_entries
        set status = 'approved', updated_at = now() - interval '400 days',
            confidence = 'low'
        where id in (${read.id}, ${idle.id})
      `;
      await sql`alter table knowledge_entries enable trigger knowledge_entries_updated_at`;
      await recordView({ entryId: read.id }, reader.id);
      await addFeedback({
        knowledgeEntryId: idle.id,
        userId: reader.id,
        kind: "rating",
        rating: 1,
      });

      const s = await knowledgeStale();
      expect(s.drafts).toEqual([
        { age: "week", n: 1 },
        { age: "month", n: 0 },
        { age: "quarter", n: 0 },
        { age: "older", n: 1 },
      ]);
      expect(s).toMatchObject({ untouched: 2, unread: 1, doubtful: 2 });
      expect(s.weakest).toEqual([
        expect.objectContaining({
          id: idle.id,
          title: "approved and idle",
          rating: 1,
          ratings: 1,
          reads: 0,
        }),
      ]);
      expect(fresh.id).toBeTruthy();
    });
  });

  describe("longer windows", () => {
    it("fills a day for every day asked for, up to 90", async () => {
      expect((await agentUsageCensus(90)).per_day).toHaveLength(90);
      expect((await toolUsageCensus(60)).per_day).toHaveLength(60);
      expect((await libraryEngagementCensus(7)).per_day).toHaveLength(7);
      expect((await sourceTrafficCensus(30)).per_day).toHaveLength(30);
    });
  });
});
