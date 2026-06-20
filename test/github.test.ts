import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGithubSource } from "@tachy/source-github";

beforeAll(() => {
  process.env.GITHUB_TOKEN = "test-token";
});
afterEach(() => vi.unstubAllGlobals());

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url.replace("https://api.github.com", "");
    // longest prefix wins so '/issues/5/comments' beats '/issues/5'
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => path.startsWith(k));
    if (!key) throw new Error(`unexpected fetch ${path}`);
    return { ok: true, json: async () => routes[key], text: async () => "" } as Response;
  }));
}

const source = () => createGithubSource({ baseUrl: "", slug: "gh", config: { repos: ["o/r"] } });

describe("github adapter", () => {
  it("maps an issue + comments into a normalized work item", async () => {
    mockFetch({
      "/repos/o/r/issues/5": {
        number: 5, title: "Bug", state: "open", html_url: "https://github.com/o/r/issues/5",
        user: { login: "alice" }, body: "it breaks", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
      },
      "/repos/o/r/issues/5/comments": [
        { id: 99, user: { login: "bob" }, body: "confirmed", created_at: "2026-01-01T12:00:00Z" },
      ],
    });
    const item = await source().fetchItem("o/r#5");
    expect(item.externalId).toBe("o/r#5");
    expect(item.kind).toBe("issue");
    expect(item.groupKey).toBe("o/r");
    expect(item.status).toBe("open");
    expect(item.messages.map((m) => m.bodyText)).toEqual(["it breaks", "confirmed"]);
  });

  it("lists issues and skips pull requests", async () => {
    mockFetch({
      "/repos/o/r/issues": [
        { number: 1, title: "real issue", state: "open", updated_at: "2026-01-01T00:00:00Z", user: { login: "a" } },
        { number: 2, title: "a PR", state: "open", pull_request: {}, updated_at: "2026-01-01T00:00:00Z", user: { login: "a" } },
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
