import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { log, runWithLogContext } from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { json, resetData, sql } from "./helpers";

afterAll(() => sql.end());

/**
 * One structured line per request, carrying the id the response header hands
 * back. load/README.md tells whoever is chasing a slow request to take the
 * `x-request-id` off the response and grep the log for it, so the two have to
 * agree — and nothing else checks that they do.
 */
type Line = Record<string, unknown>;

function captureLog(): { lines: Line[]; stop: () => void } {
  const lines: Line[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      const text = String(chunk);
      for (const raw of text.split("\n").filter(Boolean)) {
        try {
          lines.push(JSON.parse(raw));
        } catch {
          /* not one of ours */
        }
      }
      return true;
    });
  return { lines, stop: () => spy.mockRestore() };
}

const app = createApp();
const http = (lines: Line[]) => lines.filter((l) => l.event === "http");

afterEach(() => vi.restoreAllMocks());

describe("the request line", () => {
  it("logs one line per request, with method, path, status and duration", async () => {
    await resetData();
    const cap = captureLog();
    await app.request("/api/knowledge");
    cap.stop();

    const lines = http(cap.lines);
    expect(lines).toHaveLength(1);
    expect(lines[0].method).toBe("GET");
    expect(lines[0].path).toBe("/api/knowledge");
    expect(lines[0].status).toBe(200);
    expect(typeof lines[0].ms).toBe("number");
  });

  /** The header is the handle; without the id on the line it points at nothing. */
  it("logs the same id the response header returns", async () => {
    await resetData();
    const cap = captureLog();
    const res = await app.request("/api/knowledge");
    cap.stop();

    const header = res.headers.get("x-request-id");
    expect(header).toBeTruthy();
    expect(http(cap.lines)[0].req).toBe(header);
  });

  it("gives each request its own id", async () => {
    const a = await app.request("/health");
    const b = await app.request("/health");
    expect(a.headers.get("x-request-id")).not.toBe(
      b.headers.get("x-request-id"),
    );
  });
});

describe("levels", () => {
  /**
   * The Docker healthcheck fires every 30s; at info it drowns the log. Logged
   * at debug, which the default level filters out entirely — so what is
   * observable, and what matters, is that the line is not written at all.
   */
  it("keeps /health out of the log at the default level", async () => {
    const cap = captureLog();
    const res = await app.request("/health");
    cap.stop();
    expect(res.status).toBe(200);
    expect(http(cap.lines)).toEqual([]);
  });

  it("logs an ordinary request at info", async () => {
    await resetData();
    const cap = captureLog();
    await app.request("/api/knowledge");
    cap.stop();
    expect(http(cap.lines)[0].level).toBe("info");
  });

  it("raises a client error to warn and carries the reason", async () => {
    await resetData();
    const cap = captureLog();
    const res = await app.request("/api/knowledge", json({ symptoms: 42 }));
    cap.stop();

    expect(res.status).toBe(400);
    const [line] = http(cap.lines);
    expect(line.level).toBe("warn");
    expect(line.status).toBe(400);
  });

  it("logs a miss once, not twice", async () => {
    const cap = captureLog();
    await app.request("/api/no-such-route");
    cap.stop();
    expect(http(cap.lines)).toHaveLength(1);
  });
});

/**
 * The point of the AsyncLocalStorage: a line written deep in core, with no
 * request parameter threaded down to it, still carries the request's id.
 */
describe("log context", () => {
  it("stamps context fields onto lines logged inside it", () => {
    const cap = captureLog();
    runWithLogContext({ req: "abc-123" }, () => log("error", "deep_thing", {}));
    cap.stop();

    const line = cap.lines.find((l) => l.event === "deep_thing");
    expect(line?.req).toBe("abc-123");
  });

  it("merges nested contexts rather than replacing them", () => {
    const cap = captureLog();
    runWithLogContext({ req: "abc-123" }, () =>
      runWithLogContext({ tool: "search_knowledge" }, () =>
        log("info", "nested", {}),
      ),
    );
    cap.stop();

    const line = cap.lines.find((l) => l.event === "nested");
    expect(line?.req).toBe("abc-123");
    expect(line?.tool).toBe("search_knowledge");
  });

  it("does not leak context to lines logged outside it", () => {
    const cap = captureLog();
    runWithLogContext({ req: "abc-123" }, () => log("info", "inside", {}));
    log("info", "outside", {});
    cap.stop();

    expect(cap.lines.find((l) => l.event === "outside")?.req).toBeUndefined();
  });

  it("lets an explicit field win over the context", () => {
    const cap = captureLog();
    runWithLogContext({ req: "abc-123" }, () =>
      log("info", "override", { req: "explicit" }),
    );
    cap.stop();
    expect(cap.lines.find((l) => l.event === "override")?.req).toBe("explicit");
  });
});
