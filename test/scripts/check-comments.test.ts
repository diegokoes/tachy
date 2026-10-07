import { describe, expect, it } from "vitest";
import { violations } from "../../scripts/check-comments.mjs";

const rules = (path: string, source: string): string[] =>
  violations(path, source).map((found: { rule: string }) => found.rule);

const prose = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, i) => `${prefix}line ${i + 1}`).join("\n");

describe("comment length caps", () => {
  it("allows three lines in a body and refuses a fourth", () => {
    const body = (count: number) =>
      `function f() {\n${prose(count, "  // ")}\n  return 1;\n}`;
    expect(rules("a.ts", body(3))).toEqual([]);
    expect(rules("a.ts", body(4))).toEqual(["length"]);
  });

  it("allows five lines on a declaration and refuses a sixth", () => {
    const doc = (count: number) =>
      `import "x";\n/**\n${prose(count, " * ")}\n */\nexport const a = 1;`;
    expect(rules("a.ts", doc(5))).toEqual([]);
    expect(rules("a.ts", doc(6))).toEqual(["length"]);
  });

  it("allows twelve lines in the file header and refuses a thirteenth", () => {
    const header = (count: number) =>
      `/**\n${prose(count, " * ")}\n */\nimport "x";`;
    expect(rules("a.ts", header(12))).toEqual([]);
    expect(rules("a.ts", header(13))).toEqual(["length"]);
  });

  it("does not count blank separator lines", () => {
    const source = `import "x";\n/**\n * one\n *\n * two\n *\n * three\n * four\n * five\n */\nexport const a = 1;`;
    expect(rules("a.ts", source)).toEqual([]);
  });

  it("merges consecutive // lines into one comment", () => {
    const source = `const a = 1;\n// one\n// two\n// three\n// four\nconst b = 2;`;
    expect(violations("a.ts", source)).toEqual([
      expect.objectContaining({ line: 2, rule: "length" }),
    ]);
  });
});

describe("comment syntax by place", () => {
  it("accepts /** */ on declarations", () => {
    const source = [
      `import "x";`,
      `/** a */`,
      `export function f() {}`,
      `/** b */`,
      `const c = 1;`,
      `export type T = {`,
      `  /** c */`,
      `  field: string;`,
      `};`,
      `export const o = {`,
      `  /** d */`,
      `  key: 1,`,
      `};`,
    ].join("\n");
    expect(rules("a.ts", source)).toEqual([]);
  });

  it("refuses /** */ on a statement", () => {
    const source = `import { it } from "vitest";\n/** why */\nit("works", () => {});`;
    expect(rules("a.test.ts", source)).toEqual(["syntax"]);
  });

  it("refuses /* */ in script and accepts it in CSS", () => {
    expect(rules("a.ts", `const a = 1;\n/* why */\nconst b = 2;`)).toEqual([
      "syntax",
    ]);
    expect(rules("a.css", `.a {\n  /* why */\n  color: red;\n}`)).toEqual([]);
  });

  it("accepts an inline /* */ label", () => {
    expect(rules("a.ts", `f(/* dryRun */ true);`)).toEqual([]);
  });

  it("reads each part of a component with its own rules", () => {
    const source = [
      `<script lang="ts">`,
      `  let a = $state(1);`,
      `  /* why */`,
      `  $effect(() => {});`,
      `</script>`,
      ``,
      `<!-- why -->`,
      `<div class="a"></div>`,
      ``,
      `<style>`,
      `  /* why */`,
      `  .a { color: red; }`,
      `</style>`,
    ].join("\n");
    expect(violations("A.svelte", source)).toEqual([
      expect.objectContaining({ line: 3, rule: "syntax" }),
    ]);
  });

  it("does not read comment markers inside a string", () => {
    const source =
      "const a = `\n// one\n// two\n// three\n// four\n/* five */\n`;";
    expect(rules("a.ts", source)).toEqual([]);
  });
});

describe("comment content", () => {
  it("refuses a divider line", () => {
    expect(
      rules("a.ts", `const a = 1;\n// ---- section ----\nconst b = 2;`),
    ).toEqual(["banner"]);
  });

  it("refuses an em dash", () => {
    expect(rules("a.ts", `const a = 1;\n// one — two\nconst b = 2;`)).toEqual([
      "em-dash",
    ]);
  });

  it("refuses a TODO that names no issue", () => {
    expect(rules("a.ts", `const a = 1;\n// TODO: later\nconst b = 2;`)).toEqual(
      ["todo"],
    );
    expect(
      rules("a.ts", `const a = 1;\n// TODO(#12): later\nconst b = 2;`),
    ).toEqual([]);
  });

  it("refuses commented-out code", () => {
    expect(
      rules("a.ts", `const a = 1;\n// const b = compute(a);\nconst c = 3;`),
    ).toEqual(["dead-code"]);
    expect(
      rules("a.ts", `const a = 1;\n// return early when empty\nconst c = 3;`),
    ).toEqual([]);
  });

  it("leaves directives alone", () => {
    expect(
      rules("a.test.ts", `/**\n * @vitest-environment jsdom\n */\nimport "x";`),
    ).toEqual([]);
    expect(
      rules(
        "A.svelte",
        `<!-- svelte-ignore a11y_click_events_have_key_events -->\n<div></div>`,
      ),
    ).toEqual([]);
  });
});
