import { describe, expect, it } from "vitest";
import { qualityMeter } from "../../packages/web/src/knowledge/quality";

describe("the confidence and clarity scale", () => {
  it("puts both vocabularies on one three-step scale", () => {
    expect(qualityMeter("low")).toEqual({ fraction: 1 / 3, tone: "muted" });
    expect(qualityMeter("partial")).toEqual({ fraction: 2 / 3, tone: "warn" });
    expect(qualityMeter("clear")).toEqual({ fraction: 1, tone: "ok" });
  });

  it("draws nothing for an unset or unknown value", () => {
    expect(qualityMeter(null)).toBeNull();
    expect(qualityMeter("none")).toBeNull();
  });
});
