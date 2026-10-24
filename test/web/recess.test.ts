/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimFirstVisit,
  recessLine,
} from "../../packages/web/src/motion/recess";

const consoleSection = { key: "console", label: "console" };
const bar = (active: string, keys: string[]) => ({
  items: keys.map((key) => ({ key, label: key })),
  active,
  onpick: () => {},
});

describe("the typed recess", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("types the section and the tab open in it", () => {
    expect(
      recessLine(
        consoleSection,
        bar("integrations", ["overview", "integrations"]),
      ),
    ).toBe("› console/integrations");
  });

  it("leaves out a lone tab and one that is not there", () => {
    expect(recessLine(consoleSection, bar("azure", ["azure"]))).toBe(
      "› console",
    );
    expect(recessLine(consoleSection, bar("gone", ["all", "wiki"]))).toBe(
      "› console",
    );
  });

  it("types once per section per session", () => {
    expect(claimFirstVisit("console")).toBe(true);
    expect(claimFirstVisit("console")).toBe(false);
    expect(claimFirstVisit("library")).toBe(true);
  });

  it("types nothing when storage will not answer", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(claimFirstVisit("console")).toBe(false);
  });
});
