import { describe, expect, it } from "vitest";
import { settingsPointers } from "../../packages/web/src/settings/pointers";

describe("settings pointers", () => {
  it("links the settings tab a message names", () => {
    expect(
      settingsPointers(
        "no Claude credential is set for your account. add one under settings › agent",
      ),
    ).toEqual([
      { text: "no Claude credential is set for your account. add one under " },
      { text: "settings › agent", href: "/settings/agent" },
    ]);
  });

  it("leaves a name no tab carries as plain text", () => {
    const text = "add one under settings › keys";
    expect(settingsPointers(text)).toEqual([{ text }]);
  });

  it("links each pointer in a message, in either case", () => {
    const parts = settingsPointers(
      "settings › theme, then Settings › keybinds",
    );
    expect(parts.filter((p) => p.href).map((p) => p.href)).toEqual([
      "/settings/theme",
      "/settings/keybinds",
    ]);
    expect(parts.map((p) => p.text).join("")).toBe(
      "settings › theme, then Settings › keybinds",
    );
  });
});
