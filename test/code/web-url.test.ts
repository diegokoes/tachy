import { describe, expect, it } from "vitest";
import { repoFileUrl, repoPageUrl } from "../../packages/core/src/code/web-url";
import { projectPageUrl } from "../../packages/core/src/sources/web-url";

const range = {
  path: "apps/fl-be/src/main/java/Baldur Forwarder.java",
  commit: "47e80e25aa11bb22cc33dd44ee55ff6677889900",
  startLine: 37,
  endLine: 58,
};

describe("repoFileUrl", () => {
  it("links an Azure DevOps repo at the commit, selecting the range", () => {
    const url = new URL(
      repoFileUrl("https://org@dev.azure.com/org/Tvx/_git/tvx-tqx-fl", range)!,
    );
    expect(url.origin + url.pathname).toBe(
      "https://dev.azure.com/org/Tvx/_git/tvx-tqx-fl",
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
      repoFileUrl("https://org.visualstudio.com/Tvx/_git/tvx-tqx", range),
    ).toMatch(/^https:\/\/org\.visualstudio\.com\/Tvx\/_git\/tvx-tqx\?path=/);
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
    expect(repoFileUrl("https://dev.azure.com/org/Tvx", range)).toBeNull();
  });
});

describe("repoPageUrl", () => {
  it("is the clone URL without .git or the credentials in it", () => {
    expect(repoPageUrl("https://token@github.com/acme/portal.git")).toBe(
      "https://github.com/acme/portal",
    );
    expect(
      repoPageUrl("https://org@dev.azure.com/org/Tvx/_git/tvx-tqx-fl/"),
    ).toBe("https://dev.azure.com/org/Tvx/_git/tvx-tqx-fl");
  });

  it("has no page for an ssh or file remote", () => {
    expect(repoPageUrl("git@github.com:acme/portal.git")).toBeNull();
    expect(repoPageUrl("file:///tmp/repo")).toBeNull();
    expect(repoPageUrl("not a url")).toBeNull();
  });
});

describe("projectPageUrl", () => {
  it("opens an Azure DevOps project under its organization", () => {
    expect(
      projectPageUrl(
        { source_type: "azure-devops", base_url: "https://dev.azure.com/org/" },
        "Trellis",
      ),
    ).toBe("https://dev.azure.com/org/Trellis");
  });

  it("opens a GitHub repo on github.com or on an Enterprise host", () => {
    expect(
      projectPageUrl({ source_type: "github", base_url: null }, "acme/portal"),
    ).toBe("https://github.com/acme/portal");
    expect(
      projectPageUrl(
        { source_type: "github", base_url: "https://git.example.com/api/v3" },
        "acme/portal",
      ),
    ).toBe("https://git.example.com/acme/portal");
  });

  it("has no page for a Freshdesk group or a connection with no address", () => {
    expect(
      projectPageUrl(
        { source_type: "freshdesk", base_url: "https://acme.freshdesk.com" },
        "4200",
      ),
    ).toBeNull();
    expect(
      projectPageUrl({ source_type: "azure-devops", base_url: null }, "Tvx"),
    ).toBeNull();
  });
});
