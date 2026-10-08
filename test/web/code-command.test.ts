import { describe, expect, it } from "vitest";
import {
  parseCode,
  scopeOptions,
  withScopeWord,
} from "../../packages/web/src/code/codeCommand";
import {
  fileQuery,
  isLit,
  numberedLines,
  type WalkStep,
} from "../../packages/web/src/code/walkthrough";
import {
  highlightLines,
  languageOf,
} from "../../packages/web/src/markdown/highlight";
import type { Repo } from "../../packages/web/src/code/rows";

const repo = (slug: string, fields: Partial<Repo> = {}): Repo =>
  ({
    slug,
    project_key: null,
    product_slug: null,
    component_slug: null,
    index_status: "ready",
    ...fields,
  }) as Repo;

describe("parseCode", () => {
  it("offers every repo straight after the command", () => {
    expect(parseCode("/code ")).toEqual({ query: "", fresh: true });
  });

  it("completes the scope word being typed, wherever it is", () => {
    expect(parseCode("/code @por")).toEqual({ query: "por", fresh: false });
    expect(parseCode("/code @api why @we")).toEqual({
      query: "we",
      fresh: false,
    });
  });

  it("stands back once a question is being typed", () => {
    expect(parseCode("/code @api why does")).toBeNull();
    expect(parseCode("/code mail ops@example.com")).toBeNull();
    expect(parseCode("/code")).toBeNull();
    expect(parseCode("/consult @api")).toBeNull();
  });
});

describe("scopeOptions", () => {
  const repos = [
    repo("portal-api", { project_key: "Portal Mobile", component_slug: "api" }),
    repo("portal-web", { project_key: "Portal Mobile" }),
    repo("driver", { product_slug: "tpd", index_status: "error" }),
  ];

  it("lists repos, then the projects they are filed under", () => {
    expect(scopeOptions(repos, "").map((o) => o.word)).toEqual([
      "@portal-api",
      "@portal-web",
      "@driver",
      "@Portal-Mobile/",
    ]);
  });

  it("says what a row is: its project, component and a stale index", () => {
    const [api, , driver, project] = scopeOptions(repos, "");
    expect(api).toMatchObject({ hint: "Portal Mobile", desc: "api" });
    expect(driver).toMatchObject({ hint: "tpd", desc: "index error" });
    expect(project).toMatchObject({ kind: "project", desc: "2 repos" });
  });

  it("narrows by slug, project or component", () => {
    expect(scopeOptions(repos, "driv").map((o) => o.word)).toEqual(["@driver"]);
    expect(scopeOptions(repos, "mobile").map((o) => o.word)).toEqual([
      "@portal-api",
      "@portal-web",
      "@Portal-Mobile/",
    ]);
  });
});

describe("withScopeWord", () => {
  it("replaces the word being typed and leaves room for the next", () => {
    expect(withScopeWord("/code @por", "@portal-api")).toBe(
      "/code @portal-api ",
    );
    expect(withScopeWord("/code ", "@Portal-Mobile/")).toBe(
      "/code @Portal-Mobile/ ",
    );
    expect(withScopeWord("/code @api why @", "@web")).toBe(
      "/code @api why @web ",
    );
  });
});

describe("walkthrough steps", () => {
  const step: WalkStep = {
    label: "redirect",
    repo: "portal-api",
    path: "src/auth/login.ts",
    start_line: 10,
    end_line: 14,
    highlight: [
      [11, 12],
      [14, 14],
    ],
    note: "",
  };

  it("reads the numbered lines the API sends", () => {
    expect(numberedLines("10\tconst a = 1;\n11\t\treturn a;\n12\t")).toEqual([
      { number: 10, text: "const a = 1;" },
      { number: 11, text: "\treturn a;" },
      { number: 12, text: "" },
    ]);
    expect(numberedLines("")).toEqual([]);
  });

  it("lights the lines inside a highlight range", () => {
    expect([10, 11, 12, 13, 14].filter((n) => isLit(step, n))).toEqual([
      11, 12, 14,
    ]);
    expect(isLit({ ...step, highlight: undefined }, 11)).toBe(false);
  });

  it("asks for a step where it was read", () => {
    expect(fileQuery(step)).toBe("path=src%2Fauth%2Flogin.ts&start=10&end=14");
    expect(fileQuery({ ...step, ref: "legacy/1-50" })).toContain(
      "ref=legacy%2F1-50",
    );
    expect(fileQuery({ ...step, ref: "main", version: "1.51.2" })).toMatch(
      /version=1\.51\.2$/,
    );
  });
});

describe("highlightLines", () => {
  it("picks the grammar from the extension", () => {
    expect(languageOf("src/auth/login.ts")).toBe("ts");
    expect(languageOf("pom.xml")).toBe("xml");
    expect(languageOf("Makefile")).toBe("");
    expect(languageOf("notes.unknown")).toBe("");
  });

  it("gives every line balanced markup when a token spans lines", () => {
    const lines = highlightLines("/* one\n   two */\nconst a = 1;", "ts");
    expect(lines).toHaveLength(3);
    for (const line of lines)
      expect((line.match(/<span/g) ?? []).length).toBe(
        (line.match(/<\/span>/g) ?? []).length,
      );
    expect(lines[0]).toContain("hljs-comment");
    expect(lines[1]).toMatch(/^<span class="hljs-comment">/);
  });

  it("escapes code it has no grammar for", () => {
    expect(highlightLines("a < b\n<script>", "")).toEqual([
      "a &lt; b",
      "&lt;script&gt;",
    ]);
  });
});
