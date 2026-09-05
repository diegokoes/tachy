import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGithubSource } from "@tachy/source-github";

beforeAll(() => {
  process.env.GITHUB_TOKEN = "test-token";
});
afterEach(() => vi.unstubAllGlobals());

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.replace("https://api.github.com", "");
      // longest prefix wins so '/issues/5/comments' beats '/issues/5'
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => path.startsWith(k));
      if (!key) throw new Error(`unexpected fetch ${path}`);
      return {
        ok: true,
        json: async () => routes[key],
        text: async () => "",
      } as Response;
    }),
  );
}

const source = () =>
  createGithubSource({ baseUrl: "", slug: "gh", config: { repos: ["o/r"] } });

describe("github adapter", () => {
  it("maps an issue + comments into a normalized work item", async () => {
    mockFetch({
      "/repos/o/r/issues/5": {
        number: 5,
        title: "Bug",
        state: "open",
        html_url: "https://github.com/o/r/issues/5",
        user: { login: "alice" },
        body: "it breaks",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
      "/repos/o/r/issues/5/comments": [
        {
          id: 99,
          user: { login: "bob" },
          body: "confirmed",
          created_at: "2026-01-01T12:00:00Z",
        },
      ],
    });
    const item = await source().fetchItem("o/r#5");
    expect(item.externalId).toBe("o/r#5");
    expect(item.kind).toBe("issue");
    expect(item.groupKey).toBe("o/r");
    expect(item.status).toBe("open");
    expect(item.messages.map((m) => m.bodyText)).toEqual([
      "it breaks",
      "confirmed",
    ]);
  });

  it("pages through issues with more than 100 comments", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      user: { login: "bob" },
      body: `comment ${i + 1}`,
      created_at: `2026-01-01T00:00:00Z`,
    }));
    mockFetch({
      "/repos/o/r/issues/5": {
        number: 5,
        title: "Busy issue",
        state: "open",
        html_url: "https://github.com/o/r/issues/5",
        user: { login: "alice" },
        body: "it breaks",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
      "/repos/o/r/issues/5/comments?per_page=100&page=1": fullPage,
      "/repos/o/r/issues/5/comments?per_page=100&page=2": [
        {
          id: 101,
          user: { login: "carol" },
          body: "comment 101",
          created_at: "2026-01-02T00:00:00Z",
        },
      ],
    });
    const item = await source().fetchItem("o/r#5");
    expect(item.messages).toHaveLength(102);
    expect(item.messages.at(-1)?.bodyText).toBe("comment 101");
  });

  it("lists issues and skips pull requests", async () => {
    mockFetch({
      "/repos/o/r/issues": [
        {
          number: 1,
          title: "real issue",
          state: "open",
          updated_at: "2026-01-01T00:00:00Z",
          user: { login: "a" },
        },
        {
          number: 2,
          title: "a PR",
          state: "open",
          pull_request: {},
          updated_at: "2026-01-01T00:00:00Z",
          user: { login: "a" },
        },
      ],
    });
    const { items } = await source().listItems({ groupKey: "o/r" });
    expect(items.map((i) => i.title)).toEqual(["real issue"]);
  });

  it("rejects notes (GitHub has no private notes)", () => {
    expect(source().capabilities.postNote).toBe(false);
    expect(source().postNote).toBeUndefined();
  });
});

describe("github request deadline", () => {
  it("gives every request an abort signal, so a hung upstream cannot hang the turn", async () => {
    const inits: (RequestInit | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        inits.push(init);
        return {
          ok: true,
          json: async () => ({}),
          text: async () => "",
        } as Response;
      }),
    );
    await source().fetchItem("o/r#5");
    expect(inits.length).toBeGreaterThan(0);
    for (const init of inits) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("github sync pagination", () => {
  /** Answers each page from a per-repo backlog, so the cursor is exercised. */
  function mockPaged(backlog: Record<string, number>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        const repo = u.pathname.replace("/repos/", "").replace("/issues", "");
        const page = Number(u.searchParams.get("page"));
        const per = Number(u.searchParams.get("per_page"));
        const total = backlog[repo] ?? 0;
        const start = (page - 1) * per;
        const rows = Array.from(
          { length: Math.max(0, Math.min(per, total - start)) },
          (_, i) => ({
            number: start + i + 1,
            title: `issue ${start + i + 1}`,
            state: "open",
            html_url: `https://github.com/${repo}/issues/${start + i + 1}`,
            user: { login: "alice" },
            body: "",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
          }),
        );
        return {
          ok: true,
          json: async () => rows,
          text: async () => "",
        } as Response;
      }),
    );
  }

  it("walks two repos a page at a time instead of buffering both", async () => {
    mockPaged({ "o/a": 250, "o/b": 40 });
    const src = createGithubSource({
      baseUrl: "",
      slug: "gh",
      config: { repos: ["o/a", "o/b"] },
    });

    // The shape the CLI's sync loop drives.
    const seen: number[] = [];
    let cursor: string | undefined;
    let calls = 0;
    do {
      const page = await src.listItems({ cursor });
      calls++;
      seen.push(page.items.length);
      cursor = page.nextCursor;
      expect(calls).toBeLessThan(20);
    } while (cursor);

    // 100 + 100 + 50 for the first repo, then 40 for the second.
    expect(seen).toEqual([100, 100, 50, 40]);
  });

  it("steps over a repo with nothing in it", async () => {
    mockPaged({ "o/a": 0, "o/b": 3 });
    const src = createGithubSource({
      baseUrl: "",
      slug: "gh",
      config: { repos: ["o/a", "o/b"] },
    });
    const first = await src.listItems({});
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeUndefined();
  });
});
