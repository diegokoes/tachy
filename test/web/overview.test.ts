/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  ISSUE_KEYS,
  issueGroups,
} from "../../packages/web/src/admin/issueMessages";
import {
  age,
  bytes,
  duration,
  grade,
  load,
  pct,
  ratio,
  span,
} from "../../packages/web/src/admin/overview";
import {
  OWN,
  coverageTree,
  trailTo,
} from "../../packages/web/src/admin/coverage";
import type { ComponentCoverage } from "../../packages/web/src/admin/rows";
import {
  endpointP95,
  loadSummary,
  runP95,
  type TestRun,
} from "../../packages/web/src/admin/loadRuns";
import { fitRows, fitted, measureBox } from "../../packages/web/src/tui/fit";
import { portal } from "../../packages/web/src/tui/portal";

describe("issue groups", () => {
  it("words each open issue, worst first, and drops what is clear or unknown", () => {
    const groups = issueGroups({
      "labels.no_description": {
        n: 3,
        items: [{ key: "1", label: "regression" }],
      },
      "sources.untokened": {
        n: 1,
        items: [{ key: "fd", label: "freshdesk-main" }],
      },
      "repos.failing": { n: 0, items: [] },
      "something.new": { n: 4, items: [] },
    });
    expect(groups.map((g) => g.key)).toEqual([
      "sources.untokened",
      "labels.no_description",
    ]);
    expect(groups[0]).toMatchObject({
      tone: "danger",
      section: "sources",
      head: "1 source without a token",
      items: [{ key: "fd", text: "freshdesk-main has no token" }],
      more: 0,
    });
    expect(groups[1]).toMatchObject({
      head: "3 labels with no description",
      more: 2,
    });
  });

  it("words every issue the server can send", () => {
    const groups = issueGroups(
      Object.fromEntries(
        ISSUE_KEYS.map((k) => [
          k,
          { n: 2, items: [{ key: "a", label: "alpha" }] },
        ]),
      ),
    );
    expect(groups.map((g) => g.key).sort()).toEqual([...ISSUE_KEYS].sort());
    for (const g of groups) {
      expect(g.head).not.toMatch(/undefined|NaN/);
      for (const it of g.items) expect(it.text).toContain("alpha");
    }
  });

  it("prints a condition with no names as one line", () => {
    const [g] = issueGroups({ "users.no_app_admin": { n: 1, items: [] } });
    expect(g.items).toEqual([]);
    expect(g.more).toBe(0);
    expect(g.head).toMatch(/nobody is an app admin/);
  });
});

describe("overview figures", () => {
  it("reads shares and grades readiness", () => {
    expect(ratio(3, 4)).toBe(0.75);
    expect(ratio(1, 0)).toBe(0);
    expect(pct(2, 3)).toBe("67%");
    expect(pct(0, 0)).toBe("–");
    expect([grade(0, 0), grade(4, 4), grade(1, 4), grade(0, 4)]).toEqual([
      "muted",
      "ok",
      "warn",
      "danger",
    ]);
    expect([load(0.2), load(0.75), load(0.95)]).toEqual([
      "ok",
      "warn",
      "danger",
    ]);
  });

  it("prints spans, durations and sizes short", () => {
    expect(span(5 * 60_000)).toBe("5 min");
    expect(span(3 * 3_600_000)).toBe("3 h");
    expect(span(5 * 86_400_000)).toBe("5 d");
    expect(
      age("2026-09-18T10:00:00Z", Date.parse("2026-09-18T12:00:00Z")),
    ).toBe("2 h");
    expect(age(null)).toBeNull();
    expect([duration(45), duration(130), duration(3900)]).toEqual([
      "45s",
      "2m 10s",
      "1h 5m",
    ]);
    expect([bytes(512), bytes(1536), bytes(20 * 2 ** 20)]).toEqual([
      "512 B",
      "1.5 KiB",
      "20 MiB",
    ]);
  });

  it("tells how many rows fit, now and on every resize", () => {
    let observed: (() => void) | undefined;
    let disconnected = false;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        observed = cb;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    } as unknown as typeof ResizeObserver;
    const node = document.createElement("div");
    let height = 100;
    Object.defineProperty(node, "clientHeight", { get: () => height });
    const seen: number[] = [];
    const action = fitRows(node, {
      row: 1,
      gap: 0.25,
      onfit: (n) => seen.push(n),
    });
    expect(seen).toEqual([5]);
    height = 40;
    observed?.();
    observed?.();
    expect(seen).toEqual([5, 2]);
    action.update({ row: 0.5, onfit: (n) => seen.push(n) });
    expect(seen).toEqual([5, 2, 5]);
    action.destroy();
    expect(disconnected).toBe(true);
  });

  it("measures the box on mount and again only when it changes", () => {
    let observed: (() => void) | undefined;
    let disconnected = false;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        observed = cb;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    } as unknown as typeof ResizeObserver;
    const node = document.createElement("div");
    let box = { w: 300, h: 150 };
    Object.defineProperty(node, "clientWidth", { get: () => box.w });
    Object.defineProperty(node, "clientHeight", { get: () => box.h });
    const seen: string[] = [];
    const action = measureBox(node, (w, h) => seen.push(`${w}x${h}`));
    /* Synchronously, before any frame: a plot in a tab nobody is looking at
       still has to know how wide it is. */
    expect(seen).toEqual(["300x150"]);
    observed?.();
    expect(seen).toEqual(["300x150"]);
    box = { w: 300, h: 80 };
    observed?.();
    expect(seen).toEqual(["300x150", "300x80"]);
    action.update((w, h) => seen.push(`next ${w}x${h}`));
    box = { w: 200, h: 80 };
    observed?.();
    expect(seen).toEqual(["300x150", "300x80", "next 200x80"]);
    action.destroy();
    expect(disconnected).toBe(true);
  });

  /* A dialog has to escape the app's stacking context, or the top nav paints
     over any dialog tall enough to reach it. */
  it("lifts a node out to the body and takes it away again", () => {
    const host = document.createElement("div");
    const node = document.createElement("div");
    host.appendChild(node);
    document.body.appendChild(host);

    const action = portal(node);
    expect(node.parentElement).toBe(document.body);
    expect(host.contains(node)).toBe(false);

    action.destroy();
    expect(document.body.contains(node)).toBe(false);
    host.remove();
  });

  it("folds what does not fit into one more row", () => {
    expect(fitted([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], rest: [] });
    expect(fitted([1, 2, 3, 4], 3)).toEqual({ shown: [1, 2], rest: [3, 4] });
    expect(fitted([1, 2], 0)).toEqual({ shown: [1], rest: [2] });
  });
});

describe("load runs", () => {
  const run = (metrics: Record<string, Record<string, number>>): TestRun => ({
    id: "r",
    script: "smoke.js",
    profile: null,
    target: "dev",
    status: "passed",
    image_sha: null,
    summary: { metrics },
    output_tail: "",
    created_at: "2026-09-18T00:00:00Z",
    finished_at: null,
  });

  it("reads the overall and per-endpoint p95 from k6's summary", () => {
    const r = run({
      http_req_duration: { "p(95)": 212.4 },
      "http_req_duration{endpoint:search}": { "p(95)": 98.6 },
    });
    expect(runP95(r)).toBe(212);
    expect(endpointP95(r)).toEqual([{ endpoint: "search", ms: 99 }]);
    expect(runP95(run({}))).toBeNull();
  });

  const ran = (
    script: string,
    status: string,
    profile: string | null = null,
  ) => ({
    ...run({}),
    script,
    status,
    profile,
  });

  it("rates only the runs that reached a verdict", () => {
    const s = loadSummary([
      ran("smoke.js", "passed"),
      ran("smoke.js", "failed"),
      ran("search.js", "error"),
      ran("search.js", "running"),
      ran("smoke.js", "cancelled"),
    ]);
    expect(s).toMatchObject({ runs: 5, judged: 3, passed: 1 });
    expect(s.passRate).toBeCloseTo(1 / 3);
  });

  it("has no pass rate rather than a zero one when nothing finished", () => {
    expect(loadSummary([ran("smoke.js", "queued")]).passRate).toBeNull();
    expect(loadSummary([]).passRate).toBeNull();
  });

  it("ranks scripts by use and counts the stress runs among them", () => {
    const s = loadSummary([
      ran("search.js", "passed", "stress"),
      ran("smoke.js", "passed"),
      ran("smoke.js", "passed"),
      ran("search.js", "failed"),
      ran("browse.js", "passed"),
    ]);
    expect(s.stress).toBe(1);
    expect(s.byScript).toEqual([
      { script: "search.js", runs: 2, passed: 1, stress: 1 },
      { script: "smoke.js", runs: 2, passed: 2, stress: 0 },
      { script: "browse.js", runs: 1, passed: 1, stress: 0 },
    ]);
  });
});

describe("coverage map", () => {
  const comp = (
    id: string,
    product: string,
    slug: string,
    parent_id: string | null,
    searchable: number,
    entries = searchable,
  ): ComponentCoverage => ({
    id,
    parent_id,
    slug,
    name: slug,
    product_slug: product,
    product_name: product.toUpperCase(),
    entries,
    searchable,
  });

  const rows = [
    comp("a", "tpd", "printer", null, 4, 10),
    comp("b", "tpd", "label", "a", 2, 3),
    comp("c", "tpd", "scanner", "a", 0),
    comp("d", "ink", "printer", null, 7, 9),
  ];
  const keys = (bs: { key: string }[] | undefined) => bs?.map((b) => b.key);

  it("gives every component one leaf, a parent's own entries included", () => {
    const root = coverageTree(rows, "all");
    expect(keys(root.children)).toEqual(["tpd", "ink"]);
    expect(root.value).toBe(13);

    const printer = root.children![0].children![0];
    expect(printer).toMatchObject({
      key: "tpd/printer",
      value: 6,
      title: "TPD › printer: 6 searchable of 13 entries across 3 components",
    });
    expect(printer.children?.map((c) => [c.key, c.value])).toEqual([
      [`tpd/printer/${OWN}`, 4],
      ["tpd/label", 2],
      ["tpd/scanner", 0],
    ]);
    expect(printer.children![0].title).toBe(
      "TPD › printer itself: 4 searchable of 10 entries",
    );
  });

  it("keys a shared slug apart by its product", () => {
    const root = coverageTree(rows, "all");
    expect(keys(root.children![1].children)).toEqual(["ink/printer"]);
  });

  it("files a component whose parent it was not sent under its product", () => {
    const root = coverageTree([comp("x", "tpd", "orphan", "gone", 1)], "all");
    expect(keys(root.children![0].children)).toEqual(["tpd/orphan"]);
  });

  it("zooms only into groups, and lands a stale key on the root", () => {
    const root = coverageTree(rows, "all");
    expect(keys(trailTo(root, "tpd/printer"))).toEqual([
      "",
      "tpd",
      "tpd/printer",
    ]);
    expect(keys(trailTo(root, "tpd/label"))).toEqual([
      "",
      "tpd",
      "tpd/printer",
    ]);
    expect(keys(trailTo(root, "ink/printer"))).toEqual(["", "ink"]);
    expect(keys(trailTo(root, "nowhere"))).toEqual([""]);
    expect(keys(trailTo(coverageTree([], "all"), ""))).toEqual([""]);
  });
});
