import { describe, expect, it } from "vitest";
import { isHexColor, parseAppearanceDefaults } from "@tachy/contract";

describe("parseAppearanceDefaults", () => {
  it("keeps every valid field", () => {
    const full = {
      theme: "light",
      text_size: "large",
      nav_labels: "icons",
      accent: "#0dbc79",
      accent2: "#2472c8",
      font_ui: "inter",
      font_prose: "literata",
      font_mono: "jetbrains",
      date_order: "iso",
      clock: "12h",
    };
    expect(parseAppearanceDefaults(full)).toEqual(full);
  });

  it("drops invalid and unknown fields", () => {
    expect(
      parseAppearanceDefaults({
        theme: "sepia",
        accent: "red",
        font_mono: "inter",
        nav_hidden: "yes",
        warp: 1,
        clock: "24h",
      }),
    ).toEqual({ clock: "24h" });
  });

  it("keeps a gradient's far end only beside its start", () => {
    expect(parseAppearanceDefaults({ accent2: "#2472c8" })).toEqual({});
  });

  it("reads anything that is not an object as no defaults", () => {
    for (const raw of [null, undefined, "dark", 3]) {
      expect(parseAppearanceDefaults(raw)).toEqual({});
    }
  });
});

describe("isHexColor", () => {
  it("takes #rrggbb strings only", () => {
    expect(isHexColor("#A1b2C3")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor(0xabcdef)).toBe(false);
  });
});
