/**
 * @vitest-environment node
 *
 * Stated because vitest takes the directive from anywhere in the file. Under
 * jsdom the script resolves its root to a URL path and cannot list the
 * checkout.
 */
import { describe, expect, it } from "vitest";
import { checkedFiles, violations } from "../../scripts/check-copy.mjs";

type Found = { line: number; rule: string; message: string };

const found = (path: string, source: string): Found[] =>
  violations(path, source);
const rules = (path: string, source: string): string[] =>
  found(path, source).map((f) => f.rule);
const component = (markup: string, script = "") =>
  `<script lang="ts">\n${script}\n</script>\n\n${markup}\n`;

describe("case in markup", () => {
  it("flags a capitalised word in text and lets a lowercase one pass", () => {
    expect(rules("A.svelte", component("<p>No rows yet</p>"))).toEqual([
      "case",
    ]);
    expect(rules("A.svelte", component("<p>no rows yet</p>"))).toEqual([]);
  });

  it("keeps brand names and acronyms", () => {
    const text = "<p>synced from Freshdesk and Azure DevOps over the API</p>";
    expect(rules("A.svelte", component(text))).toEqual([]);
  });

  it("flags the article A that opens a sentence", () => {
    expect(rules("A.svelte", component("<p>A ticket target</p>"))).toEqual([
      "case",
    ]);
  });

  it("skips code, key names and interpolated values", () => {
    const markup =
      "<p>run <code>Get-TachyBackup</code>, press <kbd>Enter</kbd></p>\n<p>{`by ${Name}`}</p>";
    expect(rules("A.svelte", component(markup))).toEqual([]);
  });

  it("reads text props, aria labels, tips and snippet arguments", () => {
    const markup = [
      '<Field label="Name"><input /></Field>',
      '<button aria-label="Close it"></button>',
      '<span use:tip={"Show more"}></span>',
      '{@render chips("Tags", tags)}',
    ].join("\n");
    expect(found("A.svelte", component(markup)).map((f) => f.line)).toEqual([
      5, 6, 7, 8,
    ]);
  });

  it("reads both branches of a shown expression", () => {
    const markup = '<p>{open ? "hide" : "Show"}</p>';
    expect(rules("A.svelte", component(markup))).toEqual(["case"]);
  });

  it("leaves other attributes alone", () => {
    const markup = '<a href="/Library" class="Big">library</a>';
    expect(rules("A.svelte", component(markup))).toEqual([]);
  });
});

describe("case in scripts", () => {
  it("reads text keys, their branches and toasts", () => {
    const source = [
      'const a = { label: "Owner" };',
      'const b = { title: on ? "set" : "Unset" };',
      'toast("Saved");',
      'const c = { key: "Owner" };',
    ].join("\n");
    expect(found("a.ts", source).map((f) => f.line)).toEqual([1, 2, 3]);
  });

  it("reads the script block of a component at its own lines", () => {
    const source = component(
      "<p>ok</p>",
      'const col = { info: "Comma-separated" };',
    );
    expect(found("A.svelte", source)).toEqual([
      expect.objectContaining({ line: 2, rule: "case" }),
    ]);
  });

  it("reads every string of a copy file and none of a name file", () => {
    expect(
      rules(
        "packages/web/src/admin/help.ts",
        'export const INFO = { slug: "Lowercase id" };',
      ),
    ).toEqual(["case"]);
    expect(
      rules(
        "packages/web/src/theme/fonts.svelte.ts",
        'const f = { label: "Literata Serif", title: "Big" };',
      ),
    ).toEqual([]);
  });
});

describe("placeholders", () => {
  it("refuses sample text in an empty input", () => {
    expect(
      rules("A.svelte", component('<input placeholder="name@company.com" />')),
    ).toEqual(["placeholder"]);
    expect(
      rules("A.svelte", component('<textarea placeholder="why?"></textarea>')),
    ).toEqual(["placeholder"]);
  });

  it("lets an input show the value it stands for when empty", () => {
    for (const value of ["none", "any model", "anyone"])
      expect(
        rules("A.svelte", component(`<input placeholder="${value}" />`)),
      ).toEqual([]);
  });

  it("lets a picker say any, none or add, and nothing else", () => {
    for (const value of ["any", "any team", "none", "add a field"])
      expect(
        rules("A.svelte", component(`<Select placeholder="${value}" />`)),
      ).toEqual([]);
    expect(
      rules("A.svelte", component('<Select placeholder="pick a product" />')),
    ).toEqual(["placeholder"]);
  });

  it("leaves a computed placeholder to its source", () => {
    const markup = "<input placeholder={String(DEFAULT_MAX_FILE_KB)} />";
    expect(rules("A.svelte", component(markup))).toEqual([]);
  });

  it("refuses a sample in a column's placeholder, not an empty value", () => {
    expect(rules("a.ts", 'const c = { placeholder: "0 2 * * *" };')).toEqual([
      "placeholder",
    ]);
    expect(rules("a.ts", 'const c = { placeholder: "none" };')).toEqual([]);
    expect(rules("a.ts", 'const c = { placeholder: "" };')).toEqual([]);
  });
});

describe("which files it reads", () => {
  it("lists the SPA's own sources", () => {
    const files = checkedFiles();
    expect(files).toContain("packages/web/src/App.svelte");
    expect(
      files.every((path: string) => path.startsWith("packages/web/src/")),
    ).toBe(true);
  });

  it("narrows to the paths it is given, still within the SPA", () => {
    const files: string[] = checkedFiles(["packages/web/src/tui"]);
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.every((path) => path.startsWith("packages/web/src/tui/")),
    ).toBe(true);
    expect(checkedFiles(["packages/contract"])).toEqual([]);
  });
});
