/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemTypeOption } from "@tachy/contract";

const get = vi.fn();
vi.mock("../../packages/web/src/api", () => ({ api: { get } }));

const {
  az,
  ensureTypes,
  refreshProjects,
  retryTypes,
  typesFailed,
  typesNote,
  typesOf,
} = await import("../../packages/web/src/work-items/az.svelte");

const bug = { name: "Bug" } as WorkItemTypeOption;

describe("work item types", () => {
  beforeEach(() => {
    get.mockReset();
    az.types = {};
    az.projects = [];
  });

  it("asks once after a refusal, however often it is asked again", async () => {
    get.mockRejectedValue(new Error("no token for 'eng-ado'"));
    await ensureTypes("p1");
    await ensureTypes("p1");
    await ensureTypes("p1");
    expect(get).toHaveBeenCalledTimes(1);
    expect(typesFailed("p1")).toBe(true);
    expect(typesNote("p1")).toBe("no token for 'eng-ado'");
    expect(typesOf("p1")).toEqual([]);
  });

  it("asks again on retry, and keeps what it gets", async () => {
    get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([bug]);
    await ensureTypes("p2");
    await retryTypes("p2");
    await ensureTypes("p2");
    expect(get).toHaveBeenCalledTimes(2);
    expect(typesOf("p2")).toEqual([bug]);
    expect(typesFailed("p2")).toBe(false);
  });

  it("forgets refusals when the projects are refreshed", async () => {
    get.mockRejectedValueOnce(new Error("offline"));
    await ensureTypes("p3");
    get.mockResolvedValue([]);
    await refreshProjects();
    await ensureTypes("p3");
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      "/compose/projects/p3/types",
      "/compose/projects?source_type=azure-devops",
      "/compose/projects/p3/types",
    ]);
  });
});
