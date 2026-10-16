/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemPeek } from "@tachy/contract";

const answer = vi.fn();
vi.mock("../../packages/web/src/api", () => ({
  api: { get: (path: string) => answer(path) },
  ApiError: class extends Error {},
}));

const { clearPeek, peek, peekLater, workItemNumber } =
  await import("../../packages/web/src/work-items/peek.svelte");

const bug = (id: string): WorkItemPeek => ({
  id,
  title: "Print preview is blank",
  type: "Bug",
  state: "Active",
  project: "Portal",
  url: `https://dev.azure.com/org/Portal/_workitems/edit/${id}`,
  color: "CC293D",
  icon: "icon_insect",
  source_slug: "ado",
});

describe("work item peek", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    answer.mockReset();
    clearPeek();
  });
  afterEach(() => vi.useRealTimers());

  it("reads digits with or without a leading #", () => {
    expect(workItemNumber("4521")).toBe("4521");
    expect(workItemNumber("#4521")).toBe("4521");
    expect(workItemNumber("45a")).toBeNull();
    expect(workItemNumber("")).toBeNull();
  });

  it("asks once typing pauses, not on every keystroke", async () => {
    answer.mockResolvedValue([bug("4521")]);
    const cancel = peekLater("45");
    cancel();
    peekLater("4521");
    expect(peek.current).toEqual({ status: "looking", id: "4521" });
    await vi.runAllTimersAsync();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith("/work-items/peek/azure-devops/4521");
    expect(peek.current).toMatchObject({ status: "found", id: "4521" });
  });

  it("keeps a found item and asks again for a miss", async () => {
    answer.mockResolvedValue([bug("700")]);
    peekLater("700");
    await vi.runAllTimersAsync();
    peekLater("700");
    expect(peek.current).toMatchObject({ status: "found" });
    expect(answer).toHaveBeenCalledTimes(1);

    answer.mockResolvedValue([]);
    peekLater("701");
    await vi.runAllTimersAsync();
    peekLater("701");
    await vi.runAllTimersAsync();
    expect(answer).toHaveBeenCalledTimes(3);
  });

  it("drops an answer that arrives after a newer number", async () => {
    let finish: (peeks: WorkItemPeek[]) => void = () => {};
    answer.mockReturnValueOnce(new Promise((done) => (finish = done)));
    peekLater("12");
    await vi.advanceTimersByTimeAsync(400);
    clearPeek();
    finish([bug("12")]);
    await vi.runAllTimersAsync();
    expect(peek.current).toEqual({ status: "idle" });
  });

  it("says why the lookup failed", async () => {
    answer.mockRejectedValue(new Error("No token for 'ado'."));
    peekLater("9");
    await vi.runAllTimersAsync();
    expect(peek.current).toEqual({
      status: "failed",
      id: "9",
      message: "No token for 'ado'.",
    });
  });
});
