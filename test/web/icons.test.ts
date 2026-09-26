/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  ICONS,
  iconMarkup,
  iconPath,
  outline,
  shapes,
  type IconName,
} from "../../packages/web/src/lib/tui/icons";
import { renderMarkdown } from "../../packages/web/src/lib/markdown";

const names = Object.keys(ICONS) as IconName[];

describe("the registry", () => {
  it("draws every mark on Lucide's 24-unit grid", () => {
    for (const name of names) expect(ICONS[name].size ?? 24).toBe(24);
  });

  it("leaves Lucide's React keys out of the drawn shapes", () => {
    for (const name of names)
      for (const [, attrs] of shapes(name))
        expect(attrs).not.toHaveProperty("key");
    expect(iconMarkup("close")).toBe(
      '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    );
  });
});

describe("a mark as one morphable path", () => {
  it("opens every mark with an absolute move", () => {
    for (const name of names) expect(iconPath(name)).toMatch(/^M/);
  });

  it("spells a leading relative move absolute, with its implied line-tos", () => {
    expect(iconPath("chevron")).toBe("M6 9l6 6 6-6");
  });

  it("rewrites circles, rects, lines and polylines as path data", () => {
    expect(
      outline([
        ["circle", { cx: "12", cy: "12", r: "3" }],
        ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
        ["line", { x1: "6", y1: "10", x2: "7", y2: "10" }],
        ["polyline", { points: "15,9 18,9 18,11" }],
        ["polygon", { points: "1 1 2 2 3 1" }],
      ]),
    ).toBe(
      "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" +
        "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z" +
        "M6 10L7 10" +
        "M15 9 18 9 18 11" +
        "M1 1 2 2 3 1z",
    );
  });
});

describe("callout icons", () => {
  it("inline the mark's shapes in the rendered callout", () => {
    const html = renderMarkdown("> [!tip] Try this\n> body");
    expect(html).toContain('class="callout-icon"');
    for (const [, { d }] of shapes("lightbulb"))
      expect(html).toContain(`d="${d}"`);
  });
});
