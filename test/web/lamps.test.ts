import { describe, expect, it } from "vitest";
import { indexLamp } from "../../packages/web/src/code/status";
import { statusItems, statusLamp } from "../../packages/web/src/library/status";
import { reportLamp } from "../../packages/web/src/reports/status";
import { tokenLamp } from "../../packages/web/src/sources/status";
import { LAMP_GLYPHS } from "../../packages/web/src/tui/lamp";
import { lampOf } from "../../packages/web/src/tui/tone";

describe("status lamps", () => {
  it("draws settled, under way and off with three glyphs", () => {
    expect(LAMP_GLYPHS).toEqual({ on: "●", half: "◐", off: "○" });
  });

  it("lights an approved library item and half-lights a draft", () => {
    expect(statusLamp("approved")).toEqual({ level: "on", tone: "ok" });
    expect(statusLamp("draft")).toEqual({ level: "half", tone: "accent" });
    expect(statusLamp("deprecated")).toEqual({ level: "half", tone: "warn" });
    expect(statusLamp("rejected")).toEqual({ level: "off", tone: "danger" });
    expect(statusLamp("archived")).toEqual({ level: "off", tone: "muted" });
    expect(statusLamp("unheard-of")).toEqual({ level: "off", tone: "muted" });
  });

  it("offers every status with its lamp, marks the current one and says which search returns", () => {
    const items = statusItems(["draft", "approved"], "approved", ["approved"]);
    expect(items).toEqual([
      {
        key: "draft",
        label: "draft",
        lamp: { level: "half", tone: "accent" },
        hint: "not searched",
        current: false,
      },
      {
        key: "approved",
        label: "approved",
        lamp: { level: "on", tone: "ok" },
        hint: "searched",
        current: true,
      },
    ]);
  });

  it("half-lights a run while it runs and lights it once it has an outcome", () => {
    expect(lampOf("running")).toEqual({ level: "half", tone: "accent" });
    expect(lampOf("succeeded")).toEqual({ level: "on", tone: "ok" });
    expect(lampOf("failed")).toEqual({ level: "on", tone: "danger" });
    expect(lampOf("warn")).toEqual({ level: "on", tone: "warn" });
    expect(lampOf("queued")).toEqual({ level: "off", tone: "muted" });
    expect(lampOf(undefined)).toEqual({ level: "off", tone: "muted" });
  });

  it("follows a repo line from idle through indexing to ready or error", () => {
    expect(indexLamp("idle").level).toBe("off");
    expect(indexLamp("cloning")).toEqual(indexLamp("indexing"));
    expect(indexLamp("indexing").level).toBe("half");
    expect(indexLamp("ready")).toEqual({ level: "on", tone: "ok" });
    expect(indexLamp("error")).toEqual({ level: "on", tone: "danger" });
    expect(indexLamp("new-state")).toEqual(indexLamp("idle"));
  });

  it("lights a source with a token and leaves one without dark", () => {
    expect(tokenLamp("user")).toEqual({ level: "on", tone: "ok" });
    expect(tokenLamp(null)).toEqual({ level: "off", tone: "warn" });
    expect(tokenLamp(undefined)).toEqual({ level: "off", tone: "warn" });
  });

  it("keeps an open report lit until it is closed", () => {
    expect(reportLamp("open")).toEqual({ level: "on", tone: "warn" });
    expect(reportLamp("in_progress").level).toBe("half");
    expect(reportLamp("resolved")).toEqual({ level: "on", tone: "ok" });
    expect(reportLamp("closed")).toEqual({ level: "off", tone: "muted" });
  });
});
