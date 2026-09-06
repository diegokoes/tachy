import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createFreshdeskSource } from "@tachy/source-freshdesk";

beforeAll(() => {
  process.env.FRESHDESK_TOKEN = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

const requests: { path: string; init?: RequestInit }[] = [];

function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace("https://x.freshdesk.com/api/v2", "");
      calls.push(path);
      requests.push({ path, init });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => path.startsWith(k));
      if (!key) throw new Error(`unexpected fetch ${path}`);
      return {
        ok: true,
        status: 200,
        json: async () => routes[key],
        text: async () => "",
      } as Response;
    }),
  );
  return calls;
}

const source = () =>
  createFreshdeskSource({
    baseUrl: "https://x.freshdesk.com",
    slug: "fd",
    config: {},
  });

const ticket = {
  id: 7,
  subject: "printer down",
  status: 2,
  group_id: 11,
  requester_id: 42,
  requester: { email: "jane@acme.com" },
  description_text: "it stopped",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-03T00:00:00Z",
};

const convo = (id: number) => ({
  id,
  user_id: 42,
  private: false,
  incoming: true,
  body_text: `reply ${id}`,
  created_at: `2026-01-02T00:00:00Z`,
});

describe("freshdesk adapter", () => {
  it("maps a ticket + conversations into a normalized work item", async () => {
    mockFetch({
      "/tickets/7?include=requester": ticket,
      "/tickets/7/conversations?page=1": [convo(1)],
    });
    const item = await source().fetchItem("7");
    expect(item.externalId).toBe("7");
    expect(item.groupKey).toBe("11");
    expect(item.requesterEmail).toBe("jane@acme.com");
    expect(item.messages.map((m) => m.bodyText)).toEqual([
      "it stopped",
      "reply 1",
    ]);
  });

  it("pages through tickets with more than 30 conversations", async () => {
    const page1 = Array.from({ length: 30 }, (_, i) => convo(i + 1));
    mockFetch({
      "/tickets/7?include=requester": ticket,
      "/tickets/7/conversations?page=1": page1,
      "/tickets/7/conversations?page=2": [convo(31)],
    });
    const item = await source().fetchItem("7");
    expect(item.messages).toHaveLength(32);
    expect(item.messages.at(-1)?.bodyText).toBe("reply 31");
  });

  it("stops paging when a full last page is followed by an empty one", async () => {
    const page1 = Array.from({ length: 30 }, (_, i) => convo(i + 1));
    const calls = mockFetch({
      "/tickets/7?include=requester": ticket,
      "/tickets/7/conversations?page=1": page1,
      "/tickets/7/conversations?page=2": [],
    });
    const item = await source().fetchItem("7");
    expect(item.messages).toHaveLength(31);
    expect(calls.filter((c) => c.includes("/conversations")).length).toBe(2);
  });

  it("names agents on outgoing turns and flags automated mail", async () => {
    mockFetch({
      "/tickets/7?include=requester": ticket,
      "/tickets/7/conversations?page=1": [
        { ...convo(1), incoming: true, from_email: "Jane@ACME.com" },
        { ...convo(2), incoming: false, user_id: 99 },
        { ...convo(3), incoming: false, user_id: 99, automation_id: 5 },
      ],
      "/agents?per_page=100&page=1": [
        { id: 99, contact: { name: "Borja Martinez" } },
      ],
    });
    const item = await source().fetchItem("7");
    const byId = Object.fromEntries(
      item.messages.map((m) => [m.externalId, m]),
    );
    expect(byId["1"].authorLabel).toBe("jane@acme.com");
    expect(byId["2"].authorLabel).toBe("Borja Martinez");
    expect(byId["2"].automated).toBe(false);
    expect(byId["3"]).toMatchObject({
      authorLabel: "support (automated)",
      automated: true,
    });
  });

  it("still fetches when the key cannot list agents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = url.replace("https://x.freshdesk.com/api/v2", "");
        if (path.startsWith("/agents"))
          return {
            ok: false,
            status: 403,
            text: async () => "forbidden",
          } as Response;
        const body = path.includes("/conversations")
          ? [{ ...convo(1), incoming: false, user_id: 99 }]
          : ticket;
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );
    const item = await source().fetchItem("7");
    expect(item.messages.at(-1)?.authorLabel).toBeUndefined();
    expect(item.messages).toHaveLength(2);
  });

  it("posts notes privately", async () => {
    mockFetch({ "/tickets/7/notes": {} });
    await source().postNote!("7", "<p>transcript</p>", { private: true });
    const req = requests.find((r) => r.path === "/tickets/7/notes")!;
    expect(req.init?.method).toBe("POST");
    expect(JSON.parse(String(req.init?.body))).toEqual({
      body: "<p>transcript</p>",
      private: true,
    });
  });

  it("deletes a note by conversation id", async () => {
    mockFetch({ "/conversations/999": {} });
    await source().deleteNote!("999");
    const req = requests.find((r) => r.path === "/conversations/999")!;
    expect(req.init?.method).toBe("DELETE");
  });

  it("treats an already-deleted note as done, but still raises real errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: false,
        status: url.includes("/conversations/404") ? 404 : 500,
        text: async () => "boom",
      })) as unknown as typeof fetch,
    );
    await expect(source().deleteNote!("404")).resolves.toBeUndefined();
    await expect(source().deleteNote!("500")).rejects.toThrow(/500/);
  });

  it("defaults to private when the caller says nothing", async () => {
    mockFetch({ "/tickets/7/notes": {} });
    await source().postNote!("7", "<p>x</p>");
    const req = requests.find((r) => r.path === "/tickets/7/notes")!;
    expect(JSON.parse(String(req.init?.body)).private).toBe(true);
  });
});

describe("freshdesk request deadline", () => {
  it("gives every request an abort signal, so a hung upstream cannot hang the turn", async () => {
    mockFetch({ "/tickets/7": ticket, "/agents": [], "/tickets/7/notes": {} });
    await source().fetchItem("7");
    await source().postNote!("7", "note");
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests)
      expect(r.init?.signal).toBeInstanceOf(AbortSignal);
  });
});
