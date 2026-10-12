import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addSourceConnection,
  registerSource,
  syncSource,
} from "@tachy/core/sources";
import type { ListOptions, RawWorkItem } from "@tachy/core/sources";
import {
  getJobKind,
  presentRun,
  registerCoreJobs,
  type JobContext,
} from "@tachy/core/jobs";
import { resetData, sql } from "../database";

afterAll(async () => {
  await sql`delete from source_connections where slug = ${SLUG}`;
  await sql.end();
});

const SLUG = "fake-sync-conn";

const item = (externalId: string): RawWorkItem => ({
  externalId,
  kind: "ticket",
  title: `ticket ${externalId}`,
  raw: {},
  listed: true,
  messages: [],
});

let pages: RawWorkItem[][] = [];
let asked: ListOptions[] = [];
let failing = false;

registerSource("fake-sync", () => ({
  type: "fake-sync",
  capabilities: { postNote: false, incrementalSync: true },
  async fetchItem() {
    throw new Error("a sync fetches no item");
  },
  async listItems(opts: ListOptions) {
    asked.push(opts);
    if (failing) throw new Error("source is down");
    const page = opts.cursor ? Number(opts.cursor) : 0;
    return {
      items: pages[page] ?? [],
      ...(page + 1 < pages.length ? { nextCursor: String(page + 1) } : {}),
    };
  },
}));

const connection = async () => {
  const [row] = await sql`
    select last_synced_at, listed_since from source_connections where slug = ${SLUG}
  `;
  return row as { last_synced_at: Date | null; listed_since: Date | null };
};

describe("syncSource", () => {
  beforeEach(async () => {
    await resetData();
    await sql`delete from source_connections where slug = ${SLUG}`;
    await addSourceConnection({
      sourceType: "fake-sync",
      slug: SLUG,
      baseUrl: "https://example.invalid",
    });
    pages = [[item("1"), item("2")], [item("3")]];
    asked = [];
    failing = false;
  });

  it("walks every page, stores the items and moves the watermark", async () => {
    const { total, since } = await syncSource(SLUG);
    expect(total).toBe(3);
    expect(since).toBeUndefined();
    expect(asked.map((opts) => opts.cursor)).toEqual([undefined, "1"]);
    const [{ n }] = await sql`select count(*)::int as n from work_items`;
    expect(n).toBe(3);
    const after = await connection();
    expect(after.last_synced_at).toBeInstanceOf(Date);
    expect(after.listed_since).toBeNull();
  });

  it("resumes from the last clean walk", async () => {
    await syncSource(SLUG);
    const { last_synced_at } = await connection();
    asked = [];
    const { since } = await syncSource(SLUG);
    expect(since).toBe(last_synced_at!.toISOString());
    expect(asked[0].updatedSince).toBe(since);
  });

  it("walks from the reach once, then resumes", async () => {
    const first = await syncSource(SLUG, { from: "2025-10-01" });
    expect(first.since).toBe("2025-10-01T00:00:00.000Z");
    expect((await connection()).listed_since?.toISOString()).toBe(
      "2025-10-01T00:00:00.000Z",
    );

    const { last_synced_at } = await connection();
    const second = await syncSource(SLUG, { from: "2025-10-01" });
    expect(second.since).toBe(last_synced_at!.toISOString());
  });

  it("walks again when the reach moves further back, and keeps the earlier one", async () => {
    await syncSource(SLUG, { from: "2025-10-01" });
    const earlier = await syncSource(SLUG, { from: "2025-01-01" });
    expect(earlier.since).toBe("2025-01-01T00:00:00.000Z");

    await syncSource(SLUG, { since: "2026-02-01" });
    expect((await connection()).listed_since?.toISOString()).toBe(
      "2025-01-01T00:00:00.000Z",
    );
  });

  it("takes a date given for one walk over the reach and the watermark", async () => {
    await syncSource(SLUG, { from: "2025-10-01" });
    const { since } = await syncSource(SLUG, {
      since: "2026-03-01",
      from: "2025-01-01",
    });
    expect(since).toBe("2026-03-01T00:00:00.000Z");
  });

  it("reads an empty reach as none", async () => {
    const { since } = await syncSource(SLUG, { from: "  " });
    expect(since).toBeUndefined();
    expect((await connection()).listed_since).toBeNull();
  });

  it("refuses a start that is not a date", async () => {
    await expect(syncSource(SLUG, { from: "last year" })).rejects.toThrow(
      /'last year' is not a date/,
    );
    expect(asked).toHaveLength(0);
  });

  it("leaves the watermark and the reach alone on a walk of one group", async () => {
    await syncSource(SLUG, { group: "11", since: "2025-10-01" });
    expect(asked[0].groupKey).toBe("11");
    const after = await connection();
    expect(after.last_synced_at).toBeNull();
    expect(after.listed_since).toBeNull();
  });

  it("leaves the watermark and the reach alone when the walk fails", async () => {
    failing = true;
    await expect(syncSource(SLUG, { from: "2025-10-01" })).rejects.toThrow(
      /source is down/,
    );
    const after = await connection();
    expect(after.last_synced_at).toBeNull();
    expect(after.listed_since).toBeNull();
  });

  it("stops on a cursor the source returns twice", async () => {
    registerSource("fake-sync-loop", () => ({
      type: "fake-sync-loop",
      capabilities: { postNote: false, incrementalSync: true },
      async fetchItem() {
        throw new Error("a sync fetches no item");
      },
      async listItems() {
        return { items: [], nextCursor: "same" };
      },
    }));
    await sql`update source_connections set source_type = 'fake-sync-loop' where slug = ${SLUG}`;
    await expect(syncSource(SLUG)).rejects.toThrow(
      /returned the cursor 'same' twice/,
    );
  });
});

describe("source.sync", () => {
  registerCoreJobs();
  const kind = () => getJobKind("source.sync");

  beforeEach(async () => {
    await resetData();
    await sql`delete from source_connections where slug = ${SLUG}`;
    await addSourceConnection({
      sourceType: "fake-sync",
      slug: SLUG,
      baseUrl: "https://example.invalid",
    });
    pages = [[item("1"), item("2")], [item("3")]];
    asked = [];
    failing = false;
  });

  it("takes a reach that is a date, an empty one, or none", () => {
    const parse = (from?: string) =>
      kind().params.safeParse({ connection: SLUG, from }).success;
    expect(parse("2025-10-01")).toBe(true);
    expect(parse("")).toBe(true);
    expect(parse()).toBe(true);
    expect(parse("last year")).toBe(false);
  });

  it("walks from its reach and says how many items it pulled", async () => {
    const logged: string[] = [];
    const ctx = {
      signal: new AbortController().signal,
      log: (message: string) => logged.push(message),
    } as unknown as JobContext;
    const params = { connection: SLUG, from: "2025-10-01" };
    const output = await kind().run(ctx, params);
    expect(output).toEqual({ total: 3, since: "2025-10-01T00:00:00.000Z" });
    expect(logged).toEqual(["2 item(s) so far", "3 item(s) so far"]);
    expect(presentRun("source.sync", params, output!)).toEqual({
      subject: SLUG,
      outcome: "3 items pulled",
    });
  });
});
