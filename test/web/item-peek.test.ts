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

const { clearPeek, peek, peekedSource, peekLater, workItemNumber } =
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
    const cancel = peekLater("azure-devops", "45");
    cancel();
    peekLater("azure-devops", "4521");
    expect(peek.current).toEqual({ status: "looking", id: "4521" });
    await vi.runAllTimersAsync();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith("/work-items/peek/azure-devops/4521");
    expect(peek.current).toMatchObject({ status: "found", id: "4521" });
  });

  it("keeps a found item and asks again for a miss", async () => {
    answer.mockResolvedValue([bug("700")]);
    peekLater("azure-devops", "700");
    await vi.runAllTimersAsync();
    peekLater("azure-devops", "700");
    expect(peek.current).toMatchObject({ status: "found" });
    expect(answer).toHaveBeenCalledTimes(1);

    answer.mockResolvedValue([]);
    peekLater("azure-devops", "701");
    await vi.runAllTimersAsync();
    peekLater("azure-devops", "701");
    await vi.runAllTimersAsync();
    expect(answer).toHaveBeenCalledTimes(3);
  });

  it("drops an answer that arrives after a newer number", async () => {
    let finish: (peeks: WorkItemPeek[]) => void = () => {};
    answer.mockReturnValueOnce(new Promise((done) => (finish = done)));
    peekLater("azure-devops", "12");
    await vi.advanceTimersByTimeAsync(400);
    clearPeek();
    finish([bug("12")]);
    await vi.runAllTimersAsync();
    expect(peek.current).toEqual({ status: "idle" });
  });

  it("asks the source type it is given, and keeps each type's answers apart", async () => {
    answer.mockResolvedValue([{ ...bug("88"), source_slug: "fd" }]);
    peekLater("freshdesk", "88");
    await vi.runAllTimersAsync();
    expect(answer).toHaveBeenCalledWith("/work-items/peek/freshdesk/88");
    peekLater("azure-devops", "88");
    await vi.runAllTimersAsync();
    expect(answer).toHaveBeenCalledTimes(2);
  });

  it("names the source only when exactly one connection has the item", async () => {
    answer.mockResolvedValue([{ ...bug("5"), source_slug: "fd" }]);
    peekLater("freshdesk", "5");
    expect(peekedSource("5")).toBeNull();
    await vi.runAllTimersAsync();
    expect(peekedSource("5")).toBe("fd");
    expect(peekedSource("6")).toBeNull();

    answer.mockResolvedValue([
      { ...bug("7"), source_slug: "fd" },
      { ...bug("7"), source_slug: "fd-eu" },
    ]);
    peekLater("freshdesk", "7");
    await vi.runAllTimersAsync();
    expect(peekedSource("7")).toBeNull();
  });

  it("says why the lookup failed", async () => {
    answer.mockRejectedValue(new Error("No token for 'ado'."));
    peekLater("azure-devops", "9");
    await vi.runAllTimersAsync();
    expect(peek.current).toEqual({
      status: "failed",
      id: "9",
      message: "No token for 'ado'.",
    });
  });
});
