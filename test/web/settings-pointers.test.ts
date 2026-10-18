import { describe, expect, it } from "vitest";
import { settingsPointers } from "../../packages/web/src/settings/pointers";

describe("settings pointers", () => {
  it("links the settings tab a message names", () => {
    expect(
      settingsPointers(
        "No Claude credential is set for your account. Add one under Settings › agent.",
      ),
    ).toEqual([
      { text: "No Claude credential is set for your account. Add one under " },
      { text: "Settings › agent", href: "/settings/agent" },
      { text: "." },
    ]);
  });

  it("leaves a name no tab carries as plain text", () => {
    const text = "Add one under Settings › Keys.";
    expect(settingsPointers(text)).toEqual([{ text }]);
  });

  it("links each pointer in a message", () => {
    const parts = settingsPointers(
      "Settings › theme, then Settings › keybinds",
    );
    expect(parts.filter((p) => p.href).map((p) => p.href)).toEqual([
      "/settings/theme",
      "/settings/keybinds",
    ]);
    expect(parts.map((p) => p.text).join("")).toBe(
      "Settings › theme, then Settings › keybinds",
    );
  });
});
