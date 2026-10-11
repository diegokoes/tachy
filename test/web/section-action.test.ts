/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimSectionAction,
  runWhenOffered,
} from "../../packages/web/src/admin/sectionAction.svelte";

// The palette navigates to a section and then presses the add its panel
// offers. The panel mounts after the route changes, so the offer can come
// after the ask, or never, for a reader not allowed to add.
describe("runWhenOffered", () => {
  const releases: (() => void)[] = [];
  const offer = (section: string) => {
    const run = vi.fn();
    releases.push(claimSectionAction(section, { label: "add", run }));
    return run;
  };

  // Effects flush on a microtask, which advancing the fake clock lets run.
  const settle = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const release of releases.splice(0)) release();
    vi.useRealTimers();
  });

  it("presses an action already on offer", async () => {
    const run = offer("labels");
    runWhenOffered("labels");
    await settle();
    expect(run).toHaveBeenCalledOnce();
  });

  it("waits for a panel that offers its action later, and presses it once", async () => {
    runWhenOffered("teams");
    await settle();
    const run = offer("teams");
    await settle();
    expect(run).toHaveBeenCalledOnce();

    releases.pop()?.();
    const again = offer("teams");
    await settle();
    expect(again).not.toHaveBeenCalled();
  });

  it("gives up on a panel that never offers one", async () => {
    runWhenOffered("users");
    await vi.advanceTimersByTimeAsync(10_000);
    const run = offer("users");
    await settle();
    expect(run).not.toHaveBeenCalled();
  });

  it("presses only the slot asked for", async () => {
    const add = offer("repos");
    const aside = vi.fn();
    releases.push(
      claimSectionAction("repos", { label: "bulk", run: aside }, "aside"),
    );
    runWhenOffered("repos", "aside");
    await settle();
    expect(aside).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
  });
});
