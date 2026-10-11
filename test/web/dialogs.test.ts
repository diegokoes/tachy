/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  coverMode,
  enterDialog,
  isCovered,
  isTopDialog,
  leaveDialog,
} from "../../packages/web/src/tui/dialogs.svelte";
import { setScrollport } from "../../packages/web/src/shell/scrollport.svelte";

// The stack every dialog and the command palette share. The lock and the blur
// hang on it as a whole, so a dialog over a dialog must not hand them back
// when only the top one closes.
describe("the dialog stack", () => {
  const open: symbol[] = [];
  const enter = (opts?: { sinkBelow?: boolean }) => {
    const id = Symbol();
    open.push(id);
    enterDialog(id, opts);
    return id;
  };

  afterEach(() => {
    for (const id of open.splice(0)) leaveDialog(id);
    setScrollport(null);
  });

  const blurred = () => document.documentElement.hasAttribute("data-dialog");

  it("locks the page and blurs the app while any dialog is open", () => {
    const port = document.createElement("main");
    port.style.overflow = "auto";
    setScrollport(port);

    const first = enter();
    const second = enter();
    expect(blurred()).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(port.style.overflow).toBe("hidden");

    leaveDialog(second);
    expect(blurred()).toBe(true);

    leaveDialog(first);
    expect(blurred()).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(port.style.overflow).toBe("auto");
  });

  it("knows which dialog is on top and which are covered", () => {
    const below = enter();
    const above = enter();
    expect(isTopDialog(above)).toBe(true);
    expect(isCovered(below)).toBe(true);
    expect(isCovered(above)).toBe(false);

    leaveDialog(above);
    expect(isTopDialog(below)).toBe(true);
    expect(isCovered(below)).toBe(false);
    expect(isCovered(above)).toBe(false);
  });

  it("ignores leaving a dialog that never entered", () => {
    const id = enter();
    leaveDialog(Symbol());
    expect(isTopDialog(id)).toBe(true);
  });

  it("lets a covered dialog fold away unless the top layer keeps it", () => {
    enter();
    enter();
    expect(coverMode("hide")).toBe("hide");
    expect(coverMode("blur")).toBe("blur");

    enter({ sinkBelow: true });
    expect(coverMode("hide")).toBe("blur");
  });
});
