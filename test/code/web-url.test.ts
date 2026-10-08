import { describe, expect, it } from "vitest";
import { repoFileUrl } from "../../packages/core/src/code/web-url";

const range = {
  path: "apps/fl-be/src/main/java/Baldur Forwarder.java",
  commit: "47e80e25aa11bb22cc33dd44ee55ff6677889900",
  startLine: 37,
  endLine: 58,
};

describe("repoFileUrl", () => {
  it("links an Azure DevOps repo at the commit, selecting the range", () => {
    const url = new URL(
      repoFileUrl("https://org@dev.azure.com/org/TnT/_git/tnt-tpd-fl", range)!,
    );
    expect(url.origin + url.pathname).toBe(
      "https://dev.azure.com/org/TnT/_git/tnt-tpd-fl",
    );
    expect(url.username).toBe("");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      path: "/apps/fl-be/src/main/java/Baldur Forwarder.java",
      version: `GC${range.commit}`,
      line: "37",
      lineEnd: "59",
      lineStartColumn: "1",
      lineEndColumn: "1",
      lineStyle: "plain",
      _a: "contents",
    });
  });

  it("links the older visualstudio.com host the same way", () => {
    expect(
      repoFileUrl("https://org.visualstudio.com/TnT/_git/tnt-tpd", range),
    ).toMatch(/^https:\/\/org\.visualstudio\.com\/TnT\/_git\/tnt-tpd\?path=/);
  });

  it("links a GitHub repo to the blob at the commit", () => {
    expect(repoFileUrl("https://token@github.com/acme/portal.git", range)).toBe(
      `https://github.com/acme/portal/blob/${range.commit}/apps/fl-be/src/main/java/Baldur%20Forwarder.java#L37-L58`,
    );
  });

  it("has no link for a host it does not know, or a remote with no pages", () => {
    expect(
      repoFileUrl("https://git.example.com/acme/portal.git", range),
    ).toBeNull();
    expect(repoFileUrl("git@github.com:acme/portal.git", range)).toBeNull();
    expect(repoFileUrl("file:///tmp/repo", range)).toBeNull();
    expect(repoFileUrl("https://dev.azure.com/org/TnT", range)).toBeNull();
  });
});
