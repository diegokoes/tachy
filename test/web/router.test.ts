/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  isActive,
  navigate,
  router,
  section,
  segment,
  segments,
  startRouter,
} from "../../packages/web/src/lib/router.svelte";

/**
 * The SPA's whole navigation model. `RESERVED` is the part that matters most:
 * /api, /auth, /health and /assets are served by the server, so a client-side
 * navigation to one of them would swallow a real request and render nothing.
 */
beforeEach(() => {
  history.replaceState({}, "", "/");
  router.path = "/";
});

describe("path normalisation", () => {
  it.each([
    ["/library", "/library"],
    ["library", "/library"],
    ["/library/", "/library"],
    ["//library//docs//", "/library/docs"],
    ["/", "/"],
  ])("normalises %s to %s", (input, want) => {
    navigate(input);
    expect(router.path).toBe(want);
  });
});

describe("segments", () => {
  it("is empty at the root", () => {
    expect(segments()).toEqual([]);
  });

  it("splits the path and indexes into it", () => {
    navigate("/library/wiki/tpd/spooler-stalls");
    expect(segments()).toEqual(["library", "wiki", "tpd", "spooler-stalls"]);
    expect(segment(0)).toBe("library");
    expect(segment(2)).toBe("tpd");
    expect(segment(9)).toBeUndefined();
  });
});

describe("section", () => {
  it("falls back at the root", () => {
    expect(section("chat")).toBe("chat");
  });

  it("reads the first segment", () => {
    navigate("/library/docs");
    expect(section("chat")).toBe("library");
  });

  /** A server path is never a section, or the shell would render over it. */
  it.each(["api", "auth", "health", "assets"])(
    "falls back rather than treating /%s as a section",
    (reserved) => {
      router.path = `/${reserved}/whatever`;
      expect(section("chat")).toBe("chat");
    },
  );
});

describe("navigate", () => {
  it("pushes history by default and replaces on request", () => {
    const before = history.length;
    navigate("/library");
    expect(history.length).toBeGreaterThanOrEqual(before);
    navigate("/settings", { replace: true });
    expect(window.location.pathname).toBe("/settings");
  });

  it("is a no-op for the path already showing", () => {
    navigate("/library");
    const at = router.path;
    navigate("/library");
    expect(router.path).toBe(at);
  });

  /** Refusing here is what keeps a link to /api/... reaching the server. */
  it("refuses to take over a server-owned path", () => {
    navigate("/library");
    navigate("/api/knowledge");
    expect(router.path).toBe("/library");
  });
});

describe("isActive", () => {
  it("matches the path itself and anything under it", () => {
    navigate("/library/docs/42");
    expect(isActive("/library")).toBe(true);
    expect(isActive("/library/docs")).toBe(true);
    expect(isActive("/library/docs/42")).toBe(true);
  });

  /** Prefix, not substring: /libraryish must not light up the library tab. */
  it("does not match a sibling that merely shares a prefix", () => {
    navigate("/libraryish");
    expect(isActive("/library")).toBe(false);
  });

  it("normalises the prefix it is given", () => {
    navigate("/library/docs");
    expect(isActive("library/")).toBe(true);
  });
});

describe("startRouter", () => {
  it("follows the back button, and stops when torn down", () => {
    const stop = startRouter();
    history.replaceState({}, "", "/settings");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router.path).toBe("/settings");

    stop();
    history.replaceState({}, "", "/library");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router.path).toBe("/settings");
  });
});
