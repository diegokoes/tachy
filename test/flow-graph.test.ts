import { describe, expect, it, vi } from "vitest";
import type { FlowGraph, FlowStep } from "@tachy/contract";
import {
  describeCondition,
  describeTrigger,
  findStep,
  freshId,
  insertStep,
  removeStep,
  replaceStep,
  replaceTrigger,
  stepsBefore,
} from "../packages/web/src/lib/flows/graph";
import { layoutFlow } from "../packages/web/src/lib/flows/layout";

const act = (id: string): FlowStep => ({
  id,
  kind: "action",
  action: "knowledge.search",
  params: {},
});
const branch = (id: string, then: FlowStep[] = [], els: FlowStep[] = []) =>
  ({
    id,
    kind: "if",
    when: { field: "item.status", op: "eq", value: "2" },
    then,
    else: els,
  }) as FlowStep;

const g = (steps: FlowStep[]): FlowGraph => ({
  triggers: [{ id: "m", kind: "manual", params: {} }],
  steps,
});

describe("flow editing", () => {
  it("names new steps after their action without clashing", () => {
    expect(freshId(g([act("search")]), "search")).toBe("search-2");
    expect(freshId(g([]), "Post Note!")).toBe("post-note");
  });

  it("keeps an if last: steps after it go into its then branch", () => {
    const next = insertStep(
      g([act("a"), branch("i")]),
      { list: "root" },
      act("b"),
    );
    expect(next.steps.map((s) => s.id)).toEqual(["a", "i"]);
    expect(
      (next.steps[1] as { then: FlowStep[] }).then.map((s) => s.id),
    ).toEqual(["b"]);
  });

  it("an if placed mid-list takes what followed into its then branch", () => {
    const next = insertStep(
      g([act("a"), act("b")]),
      { after: "a" },
      branch("i"),
    );
    expect(next.steps.map((s) => s.id)).toEqual(["a", "i"]);
    expect(
      (next.steps[1] as { then: FlowStep[] }).then.map((s) => s.id),
    ).toEqual(["b"]);
  });

  it("adds into an else branch and removes a step anywhere", () => {
    let graph = insertStep(
      g([branch("i")]),
      { list: "else", of: "i" },
      act("e"),
    );
    expect(
      (graph.steps[0] as { else: FlowStep[] }).else.map((s) => s.id),
    ).toEqual(["e"]);
    graph = removeStep(graph, "e");
    expect((graph.steps[0] as { else: FlowStep[] }).else).toEqual([]);
  });

  it("knows which steps a run has passed before a step", () => {
    const steps = [act("a"), branch("i", [act("t1"), act("t2")], [act("e1")])];
    expect(stepsBefore(steps, "t2").map((s) => s.id)).toEqual(["a", "i", "t1"]);
    expect(stepsBefore(steps, "e1").map((s) => s.id)).toEqual(["a", "i"]);
  });

  it("lays triggers left of the start and gives every branch a slot to add to", () => {
    const d = layoutFlow(g([act("a"), branch("i", [act("t")])]));
    const start = d.nodes.find((n) => n.node.kind === "start")!;
    expect(d.triggers[0].x).toBeLessThan(start.x);
    const slots = d.nodes.filter((n) => n.node.kind === "slot");
    expect(slots).toHaveLength(2);
    expect(
      d.links
        .filter((l) => l.branch)
        .map((l) => l.branch)
        .sort(),
    ).toEqual(["else", "then"]);
  });
});

describe("what the canvas says", () => {
  it("puts a condition in a few words", () => {
    expect(
      describeCondition({
        all: [{ field: "item.raw.company_id", op: "eq", value: 42 }],
      }),
    ).toBe("company_id is 42");
    expect(
      describeCondition({
        any: [
          { field: "item.tags", op: "exists" },
          { field: "item.status", op: "in", value: ["2", "3"] },
        ],
      }),
    ).toBe("any of 2");
    expect(
      describeCondition({
        not: { field: "item.title", op: "matches", value: "" },
      }),
    ).toBe("not title matches …");
  });

  it("says where a trigger listens", () => {
    expect(
      describeTrigger({
        id: "s",
        kind: "item.synced",
        params: { connection: "desk" },
        where: { field: "item.status", op: "eq", value: "2" },
      }),
    ).toBe("desk · status is 2");
    expect(
      describeTrigger({
        id: "n",
        kind: "schedule",
        params: { cron: "0 2 * * *" },
      }),
    ).toBe("0 2 * * *");
  });

  it("replaces a step or trigger in place", () => {
    const graph = g([branch("i", [act("t")])]);
    const next = replaceStep(graph, { ...act("t"), label: "renamed" });
    expect(findStep(next.steps, "t")).toMatchObject({ label: "renamed" });
    expect(findStep(graph.steps, "t")).not.toHaveProperty("label");
    const t = replaceTrigger(graph, {
      id: "m",
      kind: "manual",
      params: { x: 1 },
    });
    expect(t.triggers[0].params).toEqual({ x: 1 });
  });
});

describe("option lists", () => {
  it("reads each list once per set of dependencies, and again after a failure", async () => {
    const { api } = await import("../packages/web/src/lib/api");
    const get = vi
      .spyOn(api, "get")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([{ value: "a", label: "A" }]);
    const { fetchOptions } =
      await import("../packages/web/src/lib/flows/options.svelte");
    await expect(fetchOptions("teams", { q: "" })).rejects.toThrow("offline");
    expect(await fetchOptions("teams", { q: "" })).toEqual([
      { value: "a", label: "A" },
    ]);
    await fetchOptions("teams");
    await fetchOptions("source.companies", { connection: "desk" });
    expect(get.mock.calls.map((c) => c[0])).toEqual([
      "/flows/options/teams",
      "/flows/options/teams",
      "/flows/options/source.companies?connection=desk",
    ]);
    get.mockRestore();
  });
});
