import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BUCKET_BATCH_VERSION, INGEST_TOKEN_PREFIX } from "@tachy/core";
import {
  createBucket,
  embedBucketChunks,
  readableBuckets,
  searchBucket,
} from "@tachy/core/buckets";
import { createUser, setTeamMember } from "@tachy/core/access";
import { flowAction, listOptions } from "@tachy/core/flows";
import { registerCoreJobs } from "@tachy/core/jobs";
import { createApp } from "../../packages/api/src/app";
import { server } from "../../packages/mcp/src/index";
import { json, loginCookie } from "../http";
import { resetData, resetJobs, sql } from "../database";

afterAll(() => sql.end());

registerCoreJobs();

const app = createApp({ passwordAuth: true });
let cookie = "";

function admin(path: string, method: string, body?: unknown) {
  return app.request(path, {
    ...(body === undefined ? {} : json(body)),
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Cookie: cookie,
    },
  });
}

function push(slug: string, token: string | null, body: unknown) {
  return app.request(`/ingest/buckets/${slug}/batches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const doc = (key: string, title: string, text: string, path = ["Guides"]) => ({
  key,
  title,
  url: `https://docs.example.com/${key}`,
  path,
  version: 1,
  modified_at: "2026-09-28T14:17:56.357Z",
  text,
  metadata: { lang: "en" },
});

const batch = (
  upserts: unknown[],
  opts: {
    deletes?: string[];
    sync?: string;
    mode?: string;
    prune?: boolean;
  } = {},
) => ({
  version: BUCKET_BATCH_VERSION,
  source: "document360",
  sync_id: opts.sync ?? "2026-10-01T10:00:00Z",
  mode: opts.mode ?? "incremental",
  batch: { index: 1, is_last: true, prune: opts.prune },
  upserts,
  deletes: (opts.deletes ?? []).map((key) => ({ key })),
});

const EOID = doc(
  "article|eoid|en",
  "Who to Contact to Register Your EOID and FID",
  "Economic operators register their EOID with the ID issuer of the member state where the facility is located.",
  ["Track & Trace", "Registration"],
);
const SERIAL = doc(
  "article|serial|en",
  "Creating a New Serialization",
  "Open the serialization panel, choose the product, and generate unique identifiers for each unit pack.",
);

let token = "";

beforeEach(async () => {
  await resetData();
  await resetJobs();
  await createUser({
    email: "admin@example.com",
    password: "a-long-password",
    role: "admin",
  });
  cookie = await loginCookie(app, "admin@example.com", "a-long-password");
  const response = await admin("/api/buckets", "POST", {
    slug: "track-and-trace",
    name: "Track & Trace docs",
    description: "The public Track & Trace knowledge base.",
    teams: ["test-team"],
  });
  expect(response.status).toBe(201);
  token = ((await response.json()) as { token: string }).token;
});

describe("bucket admin", () => {
  it("shows the token once and stores only its hash", async () => {
    expect(token.startsWith(INGEST_TOKEN_PREFIX)).toBe(true);
    const [row] =
      await sql`select ingest_token_hash, ingest_token_hint from buckets`;
    expect(Buffer.from(row.ingest_token_hash).toString()).not.toContain(token);
    expect(row.ingest_token_hint).toBe(token.slice(-4));

    const list = (await (await admin("/api/buckets", "GET")).json()) as {
      slug: string;
      teams: { slug: string }[];
    }[];
    expect(JSON.stringify(list)).not.toContain(token);
    expect(list[0].teams.map((t) => t.slug)).toEqual(["test-team"]);
  });

  it("rotating the token retires the old one", async () => {
    const response = await admin("/api/buckets/track-and-trace/token", "POST");
    const fresh = ((await response.json()) as { token: string }).token;
    expect((await push("track-and-trace", token, batch([EOID]))).status).toBe(
      401,
    );
    expect((await push("track-and-trace", fresh, batch([EOID]))).status).toBe(
      200,
    );
  });

  it("is for app admins only", async () => {
    await createUser({ email: "m@example.com", password: "a-long-password" });
    const member = await loginCookie(app, "m@example.com", "a-long-password");
    const response = await app.request("/api/buckets", {
      headers: { Cookie: member },
    });
    expect(response.status).toBe(403);
  });

  it("rejects an unknown team", async () => {
    const response = await admin("/api/buckets", "POST", {
      slug: "other",
      name: "Other",
      teams: ["no-such-team"],
    });
    expect(response.status).toBe(400);
  });
});

describe("ingest", () => {
  it("refuses a missing, wrong or other bucket's token", async () => {
    expect((await push("track-and-trace", null, batch([EOID]))).status).toBe(
      401,
    );
    expect(
      (
        await push(
          "track-and-trace",
          `${INGEST_TOKEN_PREFIX}nope`,
          batch([EOID]),
        )
      ).status,
    ).toBe(401);
    const other = await createBucket({ slug: "other", name: "Other" }, null);
    expect(
      (await push("track-and-trace", other.token, batch([EOID]))).status,
    ).toBe(401);
    expect((await push("other", token, batch([EOID]))).status).toBe(401);
  });

  it("stops answering an address that keeps sending bad tokens, for that bucket only", async () => {
    const guarded = await createBucket(
      { slug: "guarded", name: "Guarded" },
      null,
    );
    const from = (address: string, bearer: string) =>
      app.request("/ingest/buckets/guarded/batches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
          "X-Forwarded-For": address,
        },
        body: JSON.stringify(batch([EOID])),
      });

    for (let i = 0; i < 10; i++)
      expect(
        (await from("10.0.0.7", `${INGEST_TOKEN_PREFIX}guess-${i}`)).status,
      ).toBe(401);
    const refused = await from("10.0.0.7", guarded.token);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");

    expect((await from("10.0.0.8", guarded.token)).status).toBe(200);
    expect((await push("track-and-trace", token, batch([EOID]))).status).toBe(
      200,
    );
  });

  it("is not opened by a session cookie", async () => {
    const response = await app.request(
      "/ingest/buckets/track-and-trace/batches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(batch([EOID])),
      },
    );
    expect(response.status).toBe(401);
  });

  it("names the version it accepts", async () => {
    const response = await push("track-and-trace", token, {
      ...batch([EOID]),
      version: 2,
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(
      `accepts version ${BUCKET_BATCH_VERSION}`,
    );
  });

  it("upserts, skips unchanged text, deletes and prunes", async () => {
    let response = await push("track-and-trace", token, batch([EOID, SERIAL]));
    expect(await response.json()).toMatchObject({
      upserted: 2,
      unchanged: 0,
      deleted: 0,
    });

    const [{ n: chunksBefore }] =
      await sql`select count(*)::int as n from bucket_doc_chunks`;
    response = await push(
      "track-and-trace",
      token,
      batch([{ ...EOID, version: 2 }]),
    );
    expect(await response.json()).toMatchObject({ upserted: 0, unchanged: 1 });
    const [kept] =
      await sql`select version from bucket_docs where external_key = ${EOID.key}`;
    expect(kept.version).toBe("2");
    const [{ n: chunksAfter }] =
      await sql`select count(*)::int as n from bucket_doc_chunks`;
    expect(chunksAfter).toBe(chunksBefore);

    response = await push(
      "track-and-trace",
      token,
      batch([], { deletes: [SERIAL.key] }),
    );
    expect(await response.json()).toMatchObject({ deleted: 1 });

    await push("track-and-trace", token, batch([SERIAL]));
    response = await push(
      "track-and-trace",
      token,
      batch([SERIAL], { sync: "full-1", mode: "full", prune: true }),
    );
    expect(await response.json()).toMatchObject({ pruned: 1 });
    const keys = await sql`select external_key from bucket_docs`;
    expect(keys.map((k) => k.external_key)).toEqual([SERIAL.key]);

    const [bucket] =
      await sql`select source, last_sync_id, last_batch_at from buckets`;
    expect(bucket).toMatchObject({
      source: "document360",
      last_sync_id: "full-1",
    });
  });

  it("queues one embed run per bucket however many batches arrive", async () => {
    await push("track-and-trace", token, batch([EOID]));
    await push("track-and-trace", token, batch([SERIAL]));
    const runs = await sql`
      select kind, queue from job_runs where kind = 'bucket.embed' and status = 'queued'
    `;
    expect(runs).toHaveLength(1);
    expect(runs[0].queue).toBe("embed");
  });

  it("keeps a page with no text findable by its title", async () => {
    await push(
      "track-and-trace",
      token,
      batch([doc("article|video|en", "Installing the Mobile App", "")]),
    );
    const [chunk] = await sql`select chunk_text from bucket_doc_chunks`;
    expect(chunk.chunk_text).toContain("Installing the Mobile App");
  });
});

describe("search", () => {
  it("finds text before the embed job runs, and by meaning after", async () => {
    await push("track-and-trace", token, batch([EOID, SERIAL]));
    const [bucket] = await sql`select id from buckets`;

    const lexical = await searchBucket("EOID", { bucketIds: [bucket.id] });
    expect(lexical[0]).toMatchObject({
      key: EOID.key,
      bucket: "track-and-trace",
      breadcrumb: "Track & Trace > Registration",
    });

    expect(await embedBucketChunks({ bucketId: bucket.id })).toBeGreaterThan(0);
    const [{ n }] =
      await sql`select count(*)::int as n from bucket_doc_chunks where embedding is null`;
    expect(n).toBe(0);
    const semantic = await searchBucket(
      "which authority issues economic operator identifiers",
      { bucketIds: [bucket.id] },
    );
    expect(semantic[0]?.key).toBe(EOID.key);
  });

  it("narrows to a branch of the tree", async () => {
    await push("track-and-trace", token, batch([EOID, SERIAL]));
    const [bucket] = await sql`select id from buckets`;
    const rows = await searchBucket("serialization EOID", {
      bucketIds: [bucket.id],
      pathPrefix: ["Guides"],
    });
    expect(rows.map((r) => r.key)).toEqual([SERIAL.key]);
  });
});

describe("who can read a bucket", () => {
  it("members of its teams and app admins, nobody else", async () => {
    const member = await createUser({ email: "in@example.com" });
    const outsider = await createUser({ email: "out@example.com" });
    const boss = await createUser({ email: "boss@example.com", role: "admin" });
    await setTeamMember("test-team", "in@example.com", "member");

    expect((await readableBuckets(member.id)).map((b) => b.slug)).toEqual([
      "track-and-trace",
    ]);
    expect(await readableBuckets(outsider.id)).toEqual([]);
    expect(await readableBuckets(boss.id)).toHaveLength(1);
  });

  it("a flow reads only what its owner can", async () => {
    await push("track-and-trace", token, batch([EOID]));
    const outsider = await createUser({ email: "out@example.com" });
    const member = await createUser({ email: "in@example.com" });
    await setTeamMember("test-team", "in@example.com", "member");
    const action = flowAction("bucket.search");
    const ctx = (userId: string) => ({
      flowId: "f",
      flowRunId: "r",
      scope: { userId },
      userId,
      item: null,
      signal: new AbortController().signal,
      log: () => {},
      enqueue: async () => null,
    });
    const params = action.params.parse({
      bucket: "track-and-trace",
      query: "EOID",
    });

    await expect(action.run(ctx(outsider.id), params)).rejects.toThrow(
      /not shared/,
    );
    const output = (await action.run(ctx(member.id), params)) as {
      count: number;
      text: string;
    };
    expect(output.count).toBe(1);
    expect(output.text).toContain(EOID.url);

    expect(
      await listOptions("buckets", {
        scope: { userId: outsider.id },
        params: {},
      }),
    ).toEqual([]);
    expect(
      await listOptions("buckets", {
        scope: { userId: member.id },
        params: {},
      }),
    ).toEqual([
      {
        value: "track-and-trace",
        label: "Track & Trace docs",
        hint: "document360",
      },
    ]);
  });
});

describe("bucket tools", () => {
  let client: Client;

  beforeAll(async () => {
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
  });

  async function call(name: string, args: Record<string, unknown> = {}) {
    const answer = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = answer.content[0]?.text ?? "";
    return { isError: answer.isError === true, text, json: JSON.parse(text) };
  }

  it("lists, searches and fetches, citing urls", async () => {
    await push("track-and-trace", token, batch([EOID, SERIAL]));
    const listed = await call("list_buckets");
    expect(listed.json).toEqual([
      expect.objectContaining({
        slug: "track-and-trace",
        docs: 2,
        source: "document360",
      }),
    ]);

    const found = await call("search_bucket", {
      bucket: "track-and-trace",
      query: "EOID",
    });
    expect(found.json[0]).toMatchObject({
      key: EOID.key,
      url: EOID.url,
      grade: expect.any(String),
    });
    expect(found.json[0]).not.toHaveProperty("rrf");

    const none = await call("search_bucket", {
      bucket: "track-and-trace",
      query: "zzzqqq nothing",
    });
    expect(none.json.note).toMatch(/^search_bucket: no entries/);

    const full = await call("get_bucket_doc", {
      bucket: "track-and-trace",
      key: EOID.key,
    });
    expect(full.json.body).toBe(EOID.text);
  });

  it("errors on an unknown bucket", async () => {
    const answer = await client.callTool({
      name: "search_bucket",
      arguments: { bucket: "nope", query: "x" },
    });
    expect(answer.isError).toBe(true);
  });
});
