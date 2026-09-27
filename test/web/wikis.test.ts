/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.fn();
vi.mock("../../packages/web/src/lib/api", () => ({
  api: { get: () => rows() },
}));
const unauthorized = vi.fn();
vi.mock("../../packages/web/src/lib/session.svelte", () => ({
  onUnauthorized: () => unauthorized(),
}));

const { wikis, loadWikis, landingScope, rememberScope, seedArticle, takeSeed } =
  await import("../../packages/web/src/lib/wiki/wikis.svelte");
const { uploadImage } = await import("../../packages/web/src/lib/wiki/images");

const wiki = (slug: string | null, articles: number) => ({
  product_id: slug,
  product_slug: slug,
  product_name: slug,
  articles,
  open_gaps: 0,
});

describe("where /wiki opens", () => {
  beforeEach(() => localStorage.clear());

  it("reopens the wiki you were last in", async () => {
    rows.mockResolvedValue([wiki(null, 0), wiki("tpd", 1), wiki("inkmon", 9)]);
    await loadWikis();
    rememberScope("tpd");
    expect(landingScope()).toBe("tpd");
  });

  it("falls back to the wiki with the most written", async () => {
    rows.mockResolvedValue([wiki(null, 0), wiki("tpd", 1), wiki("inkmon", 9)]);
    await loadWikis();
    rememberScope("a-product-since-deleted");
    expect(landingScope()).toBe("inkmon");
  });

  it("lands on the org-wide wiki when nothing is written anywhere", async () => {
    rows.mockResolvedValue([wiki(null, 0), wiki("tpd", 0)]);
    await loadWikis();
    expect(landingScope()).toBe("general");
  });

  it("still loads, empty, when the list cannot be fetched", async () => {
    rows.mockRejectedValue(new Error("offline"));
    await loadWikis();
    expect(wikis.rows).toEqual([]);
    expect(wikis.loaded).toBe(true);
  });
});

describe("a new article seeded by a gap", () => {
  it("is handed over once, then the next new article starts blank", () => {
    seedArticle({ title: "Coding", component: "coding" });
    expect(takeSeed()).toEqual({ title: "Coding", component: "coding" });
    expect(takeSeed()).toBeNull();
  });
});

describe("uploading an image", () => {
  const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });

  it("posts the file to the wiki's own asset route", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "x", url: "/api/library/assets/x" })),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await uploadImage("tpd", file)).toEqual({
      id: "x",
      url: "/api/library/assets/x",
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/library/wiki/tpd/assets");
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("surfaces the server's reason when it refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "not an image" }), {
          status: 400,
        }),
      ),
    );
    await expect(uploadImage("tpd", file)).rejects.toThrow("not an image");
  });

  it("hands a lapsed session to the login flow", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 })),
    );
    await expect(uploadImage("tpd", file)).rejects.toThrow(/401/);
    expect(unauthorized).toHaveBeenCalled();
  });
});
