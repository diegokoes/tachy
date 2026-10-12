import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createFreshdeskSource } from "@tachy/source-freshdesk";

// A signed address is fetched as an untrusted URL, which looks its host up.
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "52.216.10.10", family: 4 }],
}));

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

const listed = (id: number, updatedAt: string) => ({
  ...ticket,
  id,
  updated_at: updatedAt,
});

/** Answers each ticket listing from its query, and returns the queries asked. */
function mockListing(pageOf: (query: URLSearchParams) => unknown[]) {
  const queries: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      queries.push(query);
      return {
        ok: true,
        status: 200,
        json: async () => pageOf(query),
        text: async () => "",
      } as Response;
    }),
  );
  return queries;
}

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

  it("reads a ticket with its requester and the times it was answered and resolved", async () => {
    const calls = mockFetch({
      "/tickets/7?include=requester": {
        ...ticket,
        responder_id: 5,
        priority: 3,
        type: "Incident",
        stats: { resolved_at: "2026-01-03T00:00:00Z" },
      },
      "/tickets/7/conversations?page=1": [],
    });
    const item = await source().fetchItem("7");
    expect(calls[0]).toBe("/tickets/7?include=requester,stats");
    expect(item).toMatchObject({
      assignee: "5",
      priority: "3",
      itemType: "Incident",
      raw: { stats: { resolved_at: "2026-01-03T00:00:00Z" } },
    });
    expect(item.listed).toBeUndefined();
  });

  it("turns a ticket's opening and its stats into events", async () => {
    mockFetch({
      "/tickets/7?include=requester": {
        ...ticket,
        stats: {
          first_responded_at: "2026-01-01T02:00:00Z",
          resolved_at: "2026-01-03T00:00:00Z",
          closed_at: null,
          pending_since: "2026-01-02T00:00:00Z",
          reopened_count: "3",
        },
      },
      "/tickets/7/conversations?page=1": [],
    });
    const item = await source().fetchItem("7");
    expect(item.events).toEqual([
      {
        externalId: "created",
        occurredAt: "2026-01-01T00:00:00Z",
        field: "created",
      },
      {
        externalId: "stats:first_responded_at:2026-01-01T02:00:00Z",
        occurredAt: "2026-01-01T02:00:00Z",
        field: "first_responded",
      },
      {
        externalId: "stats:resolved_at:2026-01-03T00:00:00Z",
        occurredAt: "2026-01-03T00:00:00Z",
        field: "resolved",
      },
      {
        externalId: "stats:pending_since:2026-01-02T00:00:00Z",
        occurredAt: "2026-01-02T00:00:00Z",
        field: "pending_since",
      },
    ]);
    expect(item.historyComplete).toBeUndefined();
  });

  it("reads the ticket's company with it, its custom fields beside the standard ones", async () => {
    const calls = mockFetch({
      "/tickets/7?include=requester": { ...ticket, company_id: 9 },
      "/tickets/7/conversations?page=1": [],
      "/companies/9": {
        id: 9,
        name: "Acme",
        custom_fields: { tier: "gold" },
      },
    });
    const item = await source().fetchItem("7");
    expect(item.customerKey).toBe("9");
    expect(item.customerRecord).toEqual({
      name: "Acme",
      record: { id: 9, name: "Acme", tier: "gold" },
    });
    expect(calls.filter((c) => c.startsWith("/companies"))).toEqual([
      "/companies/9",
    ]);
  });

  it("still reads the ticket when its company cannot be read", async () => {
    mockFetch({
      "/tickets/7?include=requester": { ...ticket, company_id: 9 },
      "/tickets/7/conversations?page=1": [],
    });
    const item = await source().fetchItem("7");
    expect(item.customerKey).toBe("9");
    expect(item.customerRecord).toBeUndefined();
    expect(item.messages).toHaveLength(1);
  });

  it("lists tickets as listings, with their stats and no messages", async () => {
    const calls = mockFetch({
      "/tickets?": [
        { ...ticket, responder_id: 5 },
        { ...ticket, id: 8, group_id: 12 },
      ],
    });
    const { items, nextCursor } = await source().listItems({
      updatedSince: "2026-01-01T00:00:00Z",
      groupKey: "11",
    });
    const query = new URLSearchParams(calls[0].split("?")[1]);
    expect(query.get("include")).toBe("stats");
    expect(query.get("updated_since")).toBe("2026-01-01T00:00:00Z");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: "7",
      assignee: "5",
      listed: true,
      messages: [],
      events: [{ field: "created" }],
    });
    expect(items[0].customerRecord).toBeUndefined();
    expect(nextCursor).toBeUndefined();
  });

  it("restarts a full page a second before its last change and leaves out what it reads again unchanged", async () => {
    const full = [
      ...Array.from({ length: 97 }, (_, i) =>
        listed(i + 1, "2026-03-01T10:01:00Z"),
      ),
      listed(98, "2026-03-01T10:04:59Z"),
      listed(99, "2026-03-01T10:05:00Z"),
      listed(100, "2026-03-01T10:05:00Z"),
    ];
    const queries = mockListing((query) =>
      query.get("updated_since") === "2026-03-01T10:00:00Z"
        ? full
        : [
            full[97],
            full[98],
            listed(100, "2026-03-01T10:05:30Z"),
            listed(101, "2026-03-01T10:06:00Z"),
          ],
    );

    const first = await source().listItems({
      updatedSince: "2026-03-01T10:00:00.500Z",
    });
    expect(first.items).toHaveLength(100);
    expect(JSON.parse(first.nextCursor!)).toEqual({
      since: "2026-03-01T10:04:59.000Z",
      page: 1,
      repeated: [
        "98@2026-03-01T10:04:59Z",
        "99@2026-03-01T10:05:00Z",
        "100@2026-03-01T10:05:00Z",
      ],
    });

    const second = await source().listItems({ cursor: first.nextCursor });
    expect(queries[1].get("updated_since")).toBe("2026-03-01T10:04:59Z");
    expect(queries[1].get("page")).toBe("1");
    // 100 changed between the two reads, so it is handed over again.
    expect(second.items.map((item) => item.externalId)).toEqual(["100", "101"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("pages on when a full page ends in the second it started in", async () => {
    const queries = mockListing(() =>
      Array.from({ length: 100 }, (_, i) =>
        listed(i + 1, "2026-03-01T10:00:00Z"),
      ),
    );
    const { nextCursor } = await source().listItems({
      updatedSince: "2026-03-01T10:00:00Z",
    });
    expect(JSON.parse(nextCursor!)).toEqual({
      since: "2026-03-01T10:00:00Z",
      page: 2,
      repeated: [],
    });
    await source().listItems({ cursor: nextCursor });
    expect(queries[1].get("page")).toBe("2");
  });

  it("pages a listing that was given no start", async () => {
    const queries = mockListing(() =>
      Array.from({ length: 100 }, (_, i) =>
        listed(i + 1, `2026-03-01T10:${String(i % 60).padStart(2, "0")}:00Z`),
      ),
    );
    const { nextCursor } = await source().listItems({});
    expect(queries[0].has("updated_since")).toBe(false);
    expect(JSON.parse(nextCursor!)).toEqual({ page: 2, repeated: [] });
  });

  it("stops at the pages one listing gives", async () => {
    mockListing(() => []);
    await expect(
      source().listItems({
        cursor: JSON.stringify({ page: 301, repeated: [] }),
      }),
    ).rejects.toThrow(/300 full pages from one start \(none given\)/);
  });

  it("refuses a start that is not a date", async () => {
    mockListing(() => []);
    await expect(
      source().listItems({ updatedSince: "last week" }),
    ).rejects.toThrow(/invalid updatedSince date: last week/);
  });

  it("lists each message's files by id and name, and leaves their signed addresses behind", async () => {
    mockFetch({
      "/tickets/7?include=requester": {
        ...ticket,
        attachments: [
          {
            id: 900,
            name: "screen.png",
            content_type: "image/png",
            size: 2048,
            attachment_url: "https://s3.example/signed?X-Amz-Expires=300",
          },
        ],
      },
      "/tickets/7/conversations?page=1": [
        {
          ...convo(1),
          attachments: [
            // The name the docs give the size on a note's own response.
            { id: 901, name: "app.log", file_size: 77 },
            { name: "no id, so nothing to open it by" },
          ],
        },
      ],
    });
    const item = await source().fetchItem("7");
    expect(item.messages.map((m) => m.attachments)).toEqual([
      [
        {
          id: "900",
          name: "screen.png",
          contentType: "image/png",
          sizeBytes: 2048,
        },
      ],
      [{ id: "901", name: "app.log", sizeBytes: 77 }],
    ]);
    expect(JSON.stringify(item.messages)).not.toContain("signed");
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
    const request = requests.find((r) => r.path === "/tickets/7/notes")!;
    expect(request.init?.method).toBe("POST");
    expect(JSON.parse(String(request.init?.body))).toEqual({
      body: "<p>transcript</p>",
      private: true,
    });
  });

  it("formats a plain-text note as markup, so its line breaks survive", async () => {
    mockFetch({ "/tickets/7/notes": {} });
    await source().postNote!(
      "7",
      "checked the spooler\n\n- restarted\n- no change",
    );
    const request = requests.find((r) => r.path === "/tickets/7/notes")!;
    expect(JSON.parse(String(request.init?.body)).body).toBe(
      '<div><p style="margin:0 0 8px 0">checked the spooler</p>' +
        '<ul style="margin:0 0 8px 0;padding-left:22px"><li>restarted</li><li>no change</li></ul></div>',
    );
  });

  it("deletes a note by conversation id", async () => {
    mockFetch({ "/conversations/999": {} });
    await source().deleteNote!("999");
    const request = requests.find((r) => r.path === "/conversations/999")!;
    expect(request.init?.method).toBe("DELETE");
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
    const request = requests.find((r) => r.path === "/tickets/7/notes")!;
    expect(JSON.parse(String(request.init?.body)).private).toBe(true);
  });
});

describe("freshdesk files", () => {
  // The two shapes Freshdesk signs a file's address in.
  const CLOUDFRONT =
    "https://x.attachments1.freshdesk.com/data/helpdesk/attachments/production/900/original/screen.png?Expires=1760000000&Signature=c2ln&Key-Pair-Id=K1";
  const S3 =
    "https://s3.amazonaws.com/cdn.freshdesk.com/data/helpdesk/attachments/production/901/original/list.xlsx?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=c2ln";
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  interface Seen {
    url: string;
    authorization: string | null;
  }

  function mockHelpdesk(
    routes: Record<string, unknown>,
    files: Record<string, () => Response> = {},
  ): Seen[] {
    const seen: Seen[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        if (files[url]) return files[url]();
        const path = url.replace("https://x.freshdesk.com/api/v2", "");
        const key = Object.keys(routes)
          .sort((a, b) => b.length - a.length)
          .find((k) => path.startsWith(k));
        if (!key) throw new Error(`unexpected fetch ${url}`);
        return {
          ok: true,
          status: 200,
          json: async () => routes[key],
          text: async () => "",
        } as Response;
      }),
    );
    return seen;
  }

  const bytesOf = async (body: ReadableStream<Uint8Array>) =>
    new Uint8Array(await new Response(body).arrayBuffer());

  const screen = {
    id: 900,
    name: "screen.png",
    content_type: "image/png",
    size: 4,
    attachment_url: CLOUDFRONT,
  };

  it("opens a file the ticket lists from its signed address, without the API key", async () => {
    const seen = mockHelpdesk(
      { "/tickets/7": { ...ticket, attachments: [screen] } },
      { [CLOUDFRONT]: () => new Response(PNG) },
    );
    const opened = await source().openAttachment!("7", "900");
    expect(opened).toMatchObject({
      name: "screen.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    expect(await bytesOf(opened.body)).toEqual(PNG);
    // The ticket listed it, so no conversation was read.
    expect(seen.map((request) => request.url)).toEqual([
      "https://x.freshdesk.com/api/v2/tickets/7",
      CLOUDFRONT,
    ]);
    expect(seen[0].authorization).toMatch(/^Basic /);
    expect(seen[1].authorization).toBeNull();
  });

  it("finds a file on a later page of conversations", async () => {
    const seen = mockHelpdesk(
      {
        "/tickets/7": ticket,
        "/tickets/7/conversations?page=1": Array.from({ length: 30 }, (_, i) =>
          convo(i + 1),
        ),
        "/tickets/7/conversations?page=2": [
          {
            ...convo(31),
            attachments: [{ id: 901, name: "list.xlsx", attachment_url: S3 }],
          },
        ],
      },
      {
        [S3]: () =>
          new Response(new Uint8Array(12), {
            headers: { "content-length": "12" },
          }),
      },
    );
    const opened = await source().openAttachment!("7", "901");
    // Unlisted, the size is the one the file's host declares.
    expect(opened).toMatchObject({ name: "list.xlsx", sizeBytes: 12 });
    expect(opened.contentType).toBeUndefined();
    expect(seen.at(-1)).toEqual({ url: S3, authorization: null });
  });

  it("stops reading conversations at the page that lists the file", async () => {
    const full = Array.from({ length: 30 }, (_, i) => convo(i + 1));
    mockHelpdesk(
      {
        "/tickets/7": ticket,
        // No second page is routed: asking for it fails the test.
        "/tickets/7/conversations?page=1": [
          { ...full[0], attachments: [screen] },
          ...full.slice(1),
        ],
      },
      { [CLOUDFRONT]: () => new Response(PNG) },
    );
    await expect(source().openAttachment!("7", "900")).resolves.toMatchObject({
      name: "screen.png",
    });
  });

  it("refuses an id the ticket does not list", async () => {
    const seen = mockHelpdesk({
      "/tickets/7": { ...ticket, attachments: [screen] },
      "/tickets/7/conversations?page=1": [convo(1)],
    });
    await expect(source().openAttachment!("7", "999")).rejects.toThrow(
      "ticket 7 lists no file '999'",
    );
    expect(
      seen.every((r) => r.url.startsWith("https://x.freshdesk.com/")),
    ).toBe(true);
  });

  it("reports a refused address by its status, never by the address", async () => {
    mockHelpdesk(
      { "/tickets/7": { ...ticket, attachments: [screen] } },
      { [CLOUDFRONT]: () => new Response("<Error/>", { status: 403 }) },
    );
    const failure = await source().openAttachment!("7", "900").catch(
      (e: Error) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Freshdesk file -> 403");
  });

  it("refuses a listing that carries no usable address", async () => {
    for (const attachment_url of [undefined, "not a url"]) {
      mockHelpdesk({
        "/tickets/7": {
          ...ticket,
          attachments: [{ ...screen, attachment_url }],
        },
      });
      await expect(source().openAttachment!("7", "900")).rejects.toThrow(
        "Freshdesk gave no address for the file",
      );
    }
  });

  // A pasted picture's address: a token on Freshdesk's host, no file name.
  const token = (id: number) =>
    `e30.${Buffer.from(
      JSON.stringify({ id, domain: "x.freshdesk.com", account_id: 1 }),
    ).toString("base64url")}.c2ln`;
  const pasted = (id: number, host = "attachment.freshdesk.com") =>
    `https://${host}/inline/attachment?token=${token(id)}`;
  const img = (src: string) =>
    `<img src="${src}" class="fr-fic fr-fil fr-dib" data-id="1">`;
  const picture = (id: number) => ({
    id: `inline-${id}`,
    name: "image.png",
    inline: true,
  });
  const redirect = (location: string) => () =>
    new Response(null, { status: 302, headers: { location } });

  it("lists the pictures pasted into a message, each once, and only Freshdesk's own", async () => {
    mockHelpdesk({
      "/agents": [],
      "/tickets/7?include=requester": {
        ...ticket,
        description: `<div>look ${img(pasted(5001))}</div>`,
        attachments: [screen],
      },
      "/tickets/7/conversations?page=1": [
        {
          ...convo(1),
          body: [
            img(pasted(5002)),
            // The reply quotes the first message, its picture included.
            `<blockquote>${img(pasted(5001))}</blockquote>`,
            // The same picture twice in one message.
            img(`${pasted(5002)}&amp;v=1`),
            img("https://dev.azure.com/org/_apis/wit/attachments/1"),
            img("data:image/png;base64,AAAA"),
            img("http://attachment.freshdesk.com/inline/attachment?token=x"),
            img(`https://files.example/inline/attachment?token=${token(9)}`),
            img(`https://attachment.freshdesk.com/other?token=${token(9)}`),
            img("https://attachment.freshdesk.com/inline/attachment"),
            img(
              "https://attachment.freshdesk.com/inline/attachment?token=a.b.c",
            ),
            img(
              `https://attachment.freshdesk.com/inline/attachment?token=e30.${Buffer.from(
                JSON.stringify({ id: "../etc" }),
              ).toString("base64url")}.c2ln`,
            ),
            // A token that names no file.
            img(
              `https://attachment.freshdesk.com/inline/attachment?token=e30.${Buffer.from(
                JSON.stringify({ domain: "x.freshdesk.com", account_id: 1 }),
              ).toString("base64url")}.c2ln`,
            ),
            "<img src='not a url'>",
          ].join(" "),
        },
      ],
    });
    const item = await source().fetchItem("7");
    expect(item.messages.map((m) => m.attachments)).toEqual([
      [
        {
          id: "900",
          name: "screen.png",
          contentType: "image/png",
          sizeBytes: 4,
        },
        picture(5001),
      ],
      [picture(5002)],
    ]);
    expect(JSON.stringify(item.messages)).not.toContain("token=");
  });

  it("lists a picture addressed on the helpdesk's own host, whatever its domain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.includes("/conversations")
          ? []
          : url.includes("/agents")
            ? []
            : {
                ...ticket,
                description: img(pasted(5003, "support.acme.com")),
              };
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );
    const item = await createFreshdeskSource({
      baseUrl: "https://support.acme.com",
      slug: "fd",
      config: {},
    }).fetchItem("7");
    expect(item.messages[0].attachments).toEqual([picture(5003)]);
  });

  it("opens a pasted picture through its redirects, with no key on any of them", async () => {
    const onHelpdesk = pasted(5001, "x.freshdesk.com");
    const seen = mockHelpdesk(
      {
        "/tickets/7": {
          ...ticket,
          description: `<div>look ${img(pasted(5001))}</div>`,
        },
      },
      {
        [pasted(5001)]: redirect(onHelpdesk),
        [onHelpdesk]: redirect(CLOUDFRONT),
        [CLOUDFRONT]: () =>
          Object.defineProperty(
            new Response(PNG, { headers: { "content-type": "image/png" } }),
            "url",
            { value: CLOUDFRONT },
          ),
      },
    );
    const opened = await source().openAttachment!("7", "inline-5001");
    // The name is the one the last address carries.
    expect(opened).toMatchObject({
      name: "screen.png",
      contentType: "image/png",
    });
    expect(await bytesOf(opened.body)).toEqual(PNG);
    expect(seen.map((request) => request.url)).toEqual([
      "https://x.freshdesk.com/api/v2/tickets/7",
      pasted(5001),
      onHelpdesk,
      CLOUDFRONT,
    ]);
    expect(seen.slice(1).map((request) => request.authorization)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("names a pasted picture by its type when its address carries no name", async () => {
    mockHelpdesk(
      {
        "/tickets/7": ticket,
        "/tickets/7/conversations?page=1": [
          { ...convo(1), body: img(pasted(5002)) },
        ],
      },
      {
        [pasted(5002)]: () =>
          new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
            headers: {
              "content-type": "image/jpeg; charset=binary",
              "content-length": "3",
            },
          }),
      },
    );
    await expect(
      source().openAttachment!("7", "inline-5002"),
    ).resolves.toMatchObject({ name: "image.jpg", sizeBytes: 3 });
  });

  it("refuses a pasted picture no message of the ticket has", async () => {
    mockHelpdesk({
      "/tickets/7": { ...ticket, description: img(pasted(5001)) },
      "/tickets/7/conversations?page=1": [convo(1)],
    });
    await expect(source().openAttachment!("7", "inline-9999")).rejects.toThrow(
      "ticket 7 lists no file 'inline-9999'",
    );
  });

  it("does not follow an address onto a private host", async () => {
    const seen = mockHelpdesk({
      "/tickets/7": {
        ...ticket,
        attachments: [
          { ...screen, attachment_url: "http://169.254.169.254/latest/" },
        ],
      },
    });
    await expect(source().openAttachment!("7", "900")).rejects.toThrow(
      "private or loopback",
    );
    expect(seen).toHaveLength(1);
  });
});

describe("freshdesk request deadline", () => {
  it("gives every request an abort signal, so a hung upstream cannot hang the turn", async () => {
    mockFetch({ "/tickets/7": ticket, "/agents": [], "/tickets/7/notes": {} });
    await source().fetchItem("7");
    await source().postNote!("7", "note");
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests)
      expect(request.init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("freshdesk companies and tags", () => {
  it("reads the ticket's company with its custom fields beside the standard ones", async () => {
    mockFetch({
      "/companies/42": {
        id: 42,
        name: "Acme",
        domains: ["acme.com"],
        custom_fields: { prod_tenant: "acme-eu" },
      },
    });
    expect(await source().customerRecord!({ company_id: 42 })).toEqual({
      id: 42,
      name: "Acme",
      domains: ["acme.com"],
      prod_tenant: "acme-eu",
    });
    expect(await source().customerRecord!({})).toBeNull();
  });

  it("lists company fields by name", async () => {
    mockFetch({
      "/company_fields": [
        { name: "name", label: "Company Name", default: true },
        { name: "prod_tenant", label: "Prod tenant", default: false },
      ],
    });
    expect(await source().options!("company_fields", {})).toEqual([
      { value: "name", label: "Company Name", hint: undefined },
      { value: "prod_tenant", label: "Prod tenant", hint: "custom" },
    ]);
  });

  it("writes the whole tag list back, since Freshdesk takes it whole", async () => {
    mockFetch({ "/tickets/7": { ...ticket, tags: ["bug", "Plant-3"] } });
    expect(
      await source().setTags!("7", { add: ["escalated"], remove: ["plant-3"] }),
    ).toEqual(["bug", "escalated"]);
    const put = requests.find((r) => r.init?.method === "PUT")!;
    expect(put.path).toBe("/tickets/7");
    expect(JSON.parse(String(put.init?.body))).toEqual({
      tags: ["bug", "escalated"],
    });
  });
});
