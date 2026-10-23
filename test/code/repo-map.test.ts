/**
 * The layout of a repo map: what folds, what is listed, and that a large repo
 * stays inside the size budget.
 */
import { describe, expect, it } from "vitest";
import { drawRepoTree, MAX_MAP_CHARS } from "@tachy/core/code";

const ADDON = [
  "Readme.md",
  "other/inbound/acme-orders.json",
  "other/inbound/acme-stock.json",
  "scripts/src/main/js/ACME/ACME.ts",
  "scripts/src/main/js/ACME/lib/AcmeErp.ts",
  "scripts/src/main/js/ACME/lib/AcmeRules.ts",
];

describe("drawRepoTree", () => {
  it("folds a chain of single folders into one line and lists files under it", () => {
    const { text, listed } = drawRepoTree(ADDON);
    expect(text.split("\n")).toEqual([
      "other/inbound/ (2 files)",
      "  acme-orders.json",
      "  acme-stock.json",
      "scripts/src/main/js/ACME/ (3 files)",
      "  lib/ (2 files)",
      "    AcmeErp.ts",
      "    AcmeRules.ts",
      "  ACME.ts",
      "Readme.md",
    ]);
    expect(listed).toHaveLength(ADDON.length);
  });

  it("adds what each file defines", () => {
    const { text } = drawRepoTree(
      ADDON,
      new Map([["scripts/src/main/js/ACME/ACME.ts", ["ACME", "logAcme"]]]),
    );
    expect(text).toContain("  ACME.ts: ACME, logAcme");
  });

  it("counts the files of a folder past the listing cap", () => {
    const paths = Array.from({ length: 40 }, (_, i) => `gen/f${i}.ts`);
    const { text, listed } = drawRepoTree(paths);
    expect(text).toContain("gen/ (40 files)");
    expect(text).toContain("+ 25 more files");
    expect(listed).toHaveLength(15);
  });

  it("opens test folders only after the others", () => {
    const grid = (top: string, file: string) =>
      Array.from({ length: 30 }, (_, d) =>
        Array.from({ length: 6 }, (_, f) => `${top}/area${d}/${file}_${f}.ts`),
      ).flat();
    const { text } = drawRepoTree([
      ...grid("tests", "a_helper_for_the_suite"),
      ...grid("src", "a_module_of_the_product"),
    ]);
    expect(text).toContain("    a_module_of_the_product_0.ts");
    expect(text).toContain("tests/ (180 files)");
    expect(text).not.toContain("a_helper_for_the_suite");
  });

  it("keeps a large repo inside the budget, deep folders folded with their counts", () => {
    const paths = Array.from({ length: 30 }, (_, d) =>
      Array.from(
        { length: 20 },
        (_, f) =>
          `module${d}/src/feature${f % 4}/file_with_a_long_name_${f}.ts`,
      ),
    ).flat();
    const names = new Map(paths.map((p) => [p, ["someExportedName", "other"]]));
    const { text } = drawRepoTree(paths, names);
    expect(text.length).toBeLessThanOrEqual(MAX_MAP_CHARS);
    expect(text).toContain("module0/src/ (20 files)");
    expect(text).toMatch(/feature\d\/ \(5 files\)$/m);
  });
});
