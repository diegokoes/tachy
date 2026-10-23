import { describe, expect, it } from "vitest";
import { MIN_AGREEING_ENTRIES, suggestComponent } from "@tachy/core/knowledge";

const hit = (component_id: string | null, grade = "good") => ({
  component_id,
  grade,
});

describe("suggestComponent", () => {
  it("names the component most good matches carry", () => {
    expect(
      suggestComponent([
        hit("scanner", "strong"),
        hit("scanner"),
        hit("scanner"),
        hit("scanner"),
        hit("billing"),
      ]),
    ).toEqual({ componentId: "scanner", agreeing: 4, of: 5 });
  });

  it(`stays silent under ${MIN_AGREEING_ENTRIES} agreeing, or without a majority`, () => {
    expect(
      suggestComponent([
        hit("scanner"),
        hit("scanner"),
        hit("billing"),
        hit("export"),
        hit("queue"),
      ]),
    ).toBeNull();
    expect(
      suggestComponent([
        hit("scanner"),
        hit("scanner"),
        hit("scanner"),
        hit("billing"),
        hit("billing"),
        hit("billing"),
      ]),
    ).toBeNull();
    expect(suggestComponent([])).toBeNull();
  });

  it("lets neither weak matches nor entries without a component vote", () => {
    expect(
      suggestComponent([
        hit("scanner"),
        hit("scanner"),
        hit("scanner", "weak"),
        hit("scanner", "weak"),
      ]),
    ).toBeNull();
    expect(
      suggestComponent([
        hit("scanner"),
        hit("scanner"),
        hit("scanner"),
        hit(null),
        hit(null),
        hit(null),
      ]),
    ).toEqual({ componentId: "scanner", agreeing: 3, of: 3 });
  });
});
