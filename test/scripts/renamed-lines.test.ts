import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHunks, renamedLines } from "../../scripts/renamed-lines";

/** The head lines proven to hold the base's code, with hunks from git itself. */
function proven(base: string, head: string): number[] {
  const dir = mkdtempSync(join(tmpdir(), "renamed-lines-"));
  try {
    writeFileSync(join(dir, "base.ts"), base);
    writeFileSync(join(dir, "head.ts"), head);
    let diff = "";
    try {
      execFileSync(
        "git",
        ["diff", "--no-index", "--unified=0", "base.ts", "head.ts"],
        { cwd: dir, encoding: "utf8" },
      );
    } catch (differs) {
      diff = (differs as { stdout: string }).stdout;
    }
    const hunks = [...parseHunks(diff).values()][0] ?? [];
    return [...renamedLines("file.ts", base, head, hunks)].sort(
      (a, b) => a - b,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lines = (...source: string[]) => source.join("\n") + "\n";

describe("parseHunks", () => {
  it("reads both sides of each hunk, with a count of 1 when git omits it", () => {
    const diff = lines(
      "diff --git a/packages/x/src/a.ts b/packages/x/src/a.ts",
      "--- a/packages/x/src/a.ts",
      "+++ b/packages/x/src/a.ts",
      "@@ -3 +3,2 @@ context",
      "@@ -10,0 +12,4 @@",
    );
    expect(parseHunks(diff).get("packages/x/src/a.ts")).toEqual([
      { baseStart: 3, baseCount: 1, headStart: 3, headCount: 2 },
      { baseStart: 10, baseCount: 0, headStart: 12, headCount: 4 },
    ]);
  });
});

describe("renamedLines", () => {
  it("proves a local renamed at its declaration and every use", () => {
    const base = lines(
      "export function total(rows: number[]) {",
      "  let t = 0;",
      "  for (const r of rows) t += r;",
      "  return t;",
      "}",
    );
    const head = lines(
      "export function total(rows: number[]) {",
      "  let sum = 0;",
      "  for (const row of rows) sum += row;",
      "  return sum;",
      "}",
    );
    expect(proven(base, head)).toEqual([2, 3, 4]);
  });

  it("proves a renamed parameter of an exported function", () => {
    const base = lines(
      "export function model(cfg: { model: string }) {",
      "  return cfg.model;",
      "}",
    );
    const head = lines(
      "export function model(config: { model: string }) {",
      "  return config.model;",
      "}",
    );
    expect(proven(base, head)).toEqual([1, 2]);
  });

  it("proves a rename the formatter broke over more lines", () => {
    const base = lines(
      "declare function send(a: string, b: string, c: string): void;",
      "export function run(cfg: string, opts: string) {",
      "  send(cfg, opts, cfg);",
      "}",
    );
    const head = lines(
      "declare function send(a: string, b: string, c: string): void;",
      "export function run(configuration: string, opts: string) {",
      "  send(",
      "    configuration,",
      "    opts,",
      "    configuration,",
      "  );",
      "}",
    );
    expect(proven(base, head)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("proves a return the formatter wrapped in parentheses", () => {
    const base = lines(
      "export function same(a: string, b: string) {",
      "  return a.length === b.length && a === b;",
      "}",
    );
    const head = lines(
      "export function same(given: string, wanted: string) {",
      "  return (",
      "    given.length === wanted.length &&",
      "    given === wanted",
      "  );",
      "}",
    );
    expect(proven(base, head)).toEqual([1, 2, 3, 4, 5]);
  });

  it("counts a line break that ends a statement early", () => {
    const base = lines(
      "export function sum(a: number, b: number) {",
      "  return a + b;",
      "}",
    );
    const head = lines(
      "export function sum(a: number, b: number) {",
      "  return",
      "  a + b;",
      "}",
    );
    expect(proven(base, head)).toEqual([]);
  });

  it("counts parentheses that change what an operator applies to", () => {
    const base = lines(
      "export function area(a: number, b: number, c: number) {",
      "  return (a + b) * c;",
      "}",
    );
    const head = base.replace("(a + b) * c", "a + b * c");
    expect(proven(base, head)).toEqual([]);
  });

  it("proves code that moved past a comment", () => {
    const base = lines(
      'import { z } from "zod";',
      "",
      "/** What the file is for. */",
      "",
      "export const text = z.string();",
    );
    const head = lines(
      "/** What the file is for. */",
      'import { z } from "zod";',
      "",
      "export const text = z.string();",
    );
    expect(proven(base, head)).toEqual([2]);
  });

  it("proves a shorthand property written out for the new name", () => {
    const base = lines(
      "export function wrap() {",
      "  const items = [1];",
      "  return { items };",
      "}",
    );
    const head = lines(
      "export function wrap() {",
      "  const linked = [1];",
      "  return { items: linked };",
      "}",
    );
    expect(proven(base, head)).toEqual([2, 3]);
  });

  it("proves a line whose comment is all that changed", () => {
    const base = lines("export const limit = 3; // the old reason");
    const head = lines("export const limit = 3; // the reason");
    expect(proven(base, head)).toEqual([1]);
  });

  it("counts a use that moved to another variable", () => {
    const base = lines(
      "declare function use(value: number): void;",
      "export function pick() {",
      "  const first = 1;",
      "  const second = 2;",
      "  use(first);",
      "  return second;",
      "}",
    );
    const head = base.replace("use(first)", "use(second)");
    expect(proven(base, head)).toEqual([]);
  });

  it("counts a use of a variable whose own declaration changed", () => {
    const base = lines(
      "declare function load(id: number): number;",
      "declare function use(value: number): void;",
      "export function pick() {",
      "  const first = load(1);",
      "  const keep = 0;",
      "  const second = load(2);",
      "  use(keep);",
      "  use(first);",
      "}",
    );
    const head = base
      .replace("load(1)", "load(3)")
      .replace("load(2)", "load(4)")
      .replace("use(first)", "use(second)");
    expect(proven(base, head)).toEqual([]);
  });

  it("proves nothing when a rename captures a name an unchanged line reads", () => {
    const base = lines(
      "declare function load(): number;",
      "export function pick(result: number) {",
      "  {",
      "    const r = load();",
      "    void r;",
      "    return result;",
      "  }",
      "}",
    );
    const head = base
      .replace("const r = load()", "const result = load()")
      .replace("void r", "void result");
    expect(proven(base, head)).toEqual([]);
  });

  it("proves nothing when a rename shadows an import an unchanged line reads", () => {
    const base = lines(
      'import { config } from "./config";',
      "export function pick(cfg: number) {",
      "  void cfg;",
      "  return config;",
      "}",
    );
    const head = base
      .replace("cfg: number", "config: number")
      .replace("void cfg", "void config");
    expect(proven(base, head)).toEqual([]);
  });

  it("counts a renamed export, a renamed property and a renamed member", () => {
    const base = lines(
      "export const MAX = 3;",
      "export const shape = { max: MAX };",
      "export class Turn {",
      "  protected q = 1;",
      "  read() {",
      "    return this.q;",
      "  }",
      "}",
    );
    const head = lines(
      "export const LIMIT = 3;",
      "export const shape = { limit: LIMIT };",
      "export class Turn {",
      "  protected queue = 1;",
      "  read() {",
      "    return this.queue;",
      "  }",
      "}",
    );
    expect(proven(base, head)).toEqual([]);
  });

  it("counts a hunk that mixes a rename with a change, and proves the rest", () => {
    const base = lines(
      "declare function load(id: number): number;",
      "export function pick() {",
      "  const r = load(1);",
      "  const keep = 0;",
      "  void keep;",
      "  return r;",
      "}",
    );
    const head = lines(
      "declare function load(id: number): number;",
      "export function pick() {",
      "  const loaded = load(2);",
      "  const keep = 0;",
      "  void keep;",
      "  return loaded;",
      "}",
    );
    expect(proven(base, head)).toEqual([]);
  });

  it("counts new code beside a proven rename", () => {
    const base = lines(
      "declare function load(id: number): number;",
      "export function pick() {",
      "  const r = load(1);",
      "  const keep = 0;",
      "  void keep;",
      "  return r;",
      "}",
    );
    const head = lines(
      "declare function load(id: number): number;",
      "export function pick() {",
      "  const loaded = load(1);",
      "  const keep = 0;",
      "  void keep;",
      "  if (loaded < 0) return 0;",
      "  return loaded;",
      "}",
    );
    expect(proven(base, head)).toEqual([3]);
  });
});
