/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RESERVED,
  conflicts,
  defaultNavKey,
  defaultSubnavKey,
  keymap,
  navKey,
  resetKeys,
  setNavKey,
  setSubnavKey,
  subnavKey,
} from "../../packages/web/src/keys/bindings.svelte";
import { pushScope, startKeys } from "../../packages/web/src/keys/keys.svelte";

const NAV = [
  { key: "chat", label: "Chat" },
  { key: "library", label: "Library" },
  { key: "admin", label: "Admin" },
];

beforeEach(() => {
  localStorage.clear();
  resetKeys();
});

describe("defaults", () => {
  it("numbers sections from 1 and subnav tabs with shift", () => {
    expect(defaultNavKey(0)).toBe("1");
    expect(defaultNavKey(2)).toBe("3");
    expect(defaultSubnavKey(0)).toBe("shift+1");
  });

  it("falls back to the slot's number when nothing is overridden", () => {
    expect(navKey("library", 1)).toBe("2");
    expect(subnavKey(1)).toBe("shift+2");
  });
});

describe("overrides", () => {
  // Section keys are stored per nav item, not per slot: navItems() drops
  // `admin` for non-curators, so slot 2 is a different destination for two
  // different users and a slot-keyed override would follow the wrong one.
  it("keeps a section's key with the section, not its position", () => {
    setNavKey("admin", "a");
    expect(navKey("admin", 2)).toBe("a");
    expect(navKey("admin", 0)).toBe("a");
  });

  it("keeps a subnav key with the slot", () => {
    setSubnavKey(1, "x");
    expect(subnavKey(1)).toBe("x");
    expect(subnavKey(0)).toBe("shift+1");
  });

  it("clears an override back to the default on null", () => {
    setNavKey("library", "l");
    setNavKey("library", null);
    expect(navKey("library", 1)).toBe("2");
  });

  it("persists across a reload", () => {
    setNavKey("library", "l");
    setSubnavKey(0, "q");
    const raw = JSON.parse(localStorage.getItem("tachy-keys") ?? "{}");
    expect(raw.nav.library).toBe("l");
    expect(raw.subnav["0"]).toBe("q");
  });

  it("resets everything at once", () => {
    setNavKey("library", "l");
    setSubnavKey(0, "q");
    resetKeys();
    expect(keymap.nav).toEqual({});
    expect(keymap.subnav).toEqual({});
    expect(navKey("library", 1)).toBe("2");
  });
});

// A collision does not error at runtime: the scope stack resolves innermost
// first, so the rebind takes the key from whichever view owns it. Warning
// beforehand is the only place it is visible.
describe("conflicts", () => {
  it("finds nothing for a free key", () => {
    expect(conflicts("z", NAV, 3)).toEqual([]);
  });

  it("names the fixed binding a rebind would shadow", () => {
    expect(conflicts("ctrl+k", NAV, 0)).toEqual([RESERVED["ctrl+k"]]);
  });

  it("names the section already holding the key", () => {
    expect(conflicts("2", NAV, 0)).toEqual(["section “Library”"]);
  });

  it("names the subnav slot already holding the key", () => {
    expect(conflicts("shift+2", [], 3)).toEqual(["sub tab 2"]);
  });

  // Rebinding a key to itself is not a conflict with itself.
  it("skips the binding being edited", () => {
    expect(conflicts("2", NAV, 0, { kind: "nav", item: "library" })).toEqual(
      [],
    );
    expect(conflicts("shift+2", [], 3, { kind: "subnav", slot: 1 })).toEqual(
      [],
    );
  });

  it("reports every collision, not just the first", () => {
    setNavKey("chat", "shift+1");
    expect(conflicts("shift+1", NAV, 2)).toEqual([
      "section “Chat”",
      "sub tab 1",
    ]);
  });

  it("names an action outside the tab bar holding the key", () => {
    expect(conflicts("ctrl+.", NAV, 0)).toEqual(["feedback"]);
    expect(
      conflicts("ctrl+.", NAV, 0, { kind: "action", item: "feedback" }),
    ).toEqual([]);
  });

  it("respects an override when deciding what collides", () => {
    setNavKey("library", "l");
    expect(conflicts("2", NAV, 0)).toEqual([]);
    expect(conflicts("l", NAV, 0)).toEqual(["section “Library”"]);
  });
});

describe("dispatch", () => {
  let teardown: (() => void)[] = [];

  beforeEach(() => {
    teardown = [startKeys()];
  });

  afterEach(() => {
    for (const stop of teardown) stop();
    document.body.replaceChildren();
  });

  const press = (key: string, target: EventTarget = document.body) => {
    const e = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(e);
    return e;
  };

  const focusedInput = (parent: HTMLElement = document.body) => {
    const input = document.createElement("input");
    parent.append(input);
    input.focus();
    return input;
  };

  const bind = (...keys: string[]) => {
    const ran: string[] = [];
    teardown.push(
      pushScope(
        keys.map((key) => ({ key, label: key, run: () => ran.push(key) })),
      ),
    );
    return ran;
  };

  it("leaves a text field on Escape", () => {
    const input = focusedInput();
    press("Escape", input);
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps focus when the field spent Escape itself", () => {
    const input = focusedInput();
    input.addEventListener("keydown", (e) => e.preventDefault());
    press("Escape", input);
    expect(document.activeElement).toBe(input);
  });

  it("keeps focus inside a dialog, which closes on Escape instead", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    const input = focusedInput(dialog);
    press("Escape", input);
    expect(document.activeElement).toBe(input);
  });

  it("keeps focus on any other key", () => {
    const input = focusedInput();
    press("a", input);
    expect(document.activeElement).toBe(input);
  });

  // A prefix that goes nowhere must not eat the key typed after it.
  it("reads a key on its own when it does not continue the sequence", () => {
    const ran = bind("g g", "j");
    press("g");
    const e = press("j");
    expect(ran).toEqual(["j"]);
    expect(e.defaultPrevented).toBe(true);
  });

  it("starts a new sequence from the key that broke the last one", () => {
    const ran = bind("g g", "d d");
    press("g");
    expect(press("d").defaultPrevented).toBe(true);
    press("d");
    expect(ran).toEqual(["d d"]);
  });

  it("lets an unbound key through after a broken sequence", () => {
    const ran = bind("g g");
    press("g");
    expect(press("x").defaultPrevented).toBe(false);
    expect(ran).toEqual([]);
  });
});
