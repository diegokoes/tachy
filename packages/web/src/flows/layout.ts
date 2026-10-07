import { hierarchy, tree } from "d3-hierarchy";
import type { FlowGraph, FlowStep, FlowTrigger } from "@tachy/contract";
import type { Slot } from "./graph";

export const NODE_W = 190;
export const NODE_H = 56;
export const SLOT = 26;
const COL = NODE_W + 56;
const ROW = NODE_H + 26;

/** What the canvas draws: the start, a step, or a place a step can go. */
export type TreeNode =
  | { key: string; kind: "start" }
  | { key: string; kind: "step"; step: FlowStep; branch?: "then" | "else" }
  | { key: string; kind: "slot"; slot: Slot; branch?: "then" | "else" };

type Branch = TreeNode & { children?: Branch[] };

/**
 * A list of steps as a chain: each step's child is the one after it, the last
 * one's is a slot to add to, and an if's are the heads of its two branches.
 */
function chain(
  steps: FlowStep[],
  empty: Slot,
  branch?: "then" | "else",
): Branch {
  if (!steps.length)
    return {
      key: `slot:${JSON.stringify(empty)}`,
      kind: "slot",
      slot: empty,
      branch,
    };
  const [head, ...rest] = steps;
  const node: Branch = { key: head.id, kind: "step", step: head, branch };
  if (head.kind === "if")
    node.children = [
      chain(head.then, { list: "then", of: head.id }, "then"),
      chain(head.else, { list: "else", of: head.id }, "else"),
    ];
  else
    node.children = [
      rest.length
        ? chain(rest, { after: head.id })
        : {
            key: `slot:after:${head.id}`,
            kind: "slot",
            slot: { after: head.id },
          },
    ];
  return node;
}

export interface Placed {
  node: TreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Drawn {
  nodes: Placed[];
  triggers: {
    trigger: FlowTrigger;
    x: number;
    y: number;
    w: number;
    h: number;
  }[];
  /** Where the add-a-trigger handle sits, under the triggers. */
  addTrigger: { x: number; y: number };
  links: {
    key: string;
    from: [number, number];
    to: [number, number];
    branch?: "then" | "else";
  }[];
  width: number;
  height: number;
}

const size = (n: TreeNode) =>
  n.kind === "slot" ? { w: SLOT, h: SLOT } : { w: NODE_W, h: NODE_H };

/**
 * Lays the flow out left to right: its triggers stacked in the first column,
 * all leading into the start, and the steps as a tree from there.
 */
export function layoutFlow(graph: FlowGraph): Drawn {
  const root: Branch = {
    key: "start",
    kind: "start",
    children: [chain(graph.steps, { list: "root" })],
  };
  const h = hierarchy<Branch>(root, (d) => d.children);
  tree<Branch>().nodeSize([ROW, COL])(h);

  const all = h.descendants();
  const minY = Math.min(...all.map((d) => d.x ?? 0));
  const x0 = COL;
  const y0 = -minY + NODE_H;
  const nodes: Placed[] = all.map((laid) => {
    const { w, h: height } = size(laid.data);
    const cx = x0 + (laid.y ?? 0);
    const cy = y0 + (laid.x ?? 0);
    return {
      node: laid.data,
      x: cx,
      y: cy - height / 2,
      w,
      h: height,
    };
  });
  const at = new Map(nodes.map((p) => [p.node.key, p]));

  const links: Drawn["links"] = [];
  for (const laid of all)
    for (const child of laid.children ?? []) {
      const from = at.get(laid.data.key)!;
      const to = at.get(child.data.key)!;
      links.push({
        key: `${from.node.key}>${to.node.key}`,
        from: [from.x + from.w, from.y + from.h / 2],
        to: [to.x, to.y + to.h / 2],
        branch: child.data.kind !== "start" ? child.data.branch : undefined,
      });
    }

  const start = at.get("start")!;
  const tx = 0;
  const count = graph.triggers.length;
  const stackH = count * ROW;
  const top = start.y + start.h / 2 - stackH / 2 + (ROW - NODE_H) / 2;
  const triggerWidth = NODE_W - 20;
  const triggers = graph.triggers.map((trigger, i) => ({
    trigger,
    x: tx,
    y: top + i * ROW,
    w: triggerWidth,
    h: NODE_H,
  }));
  for (const placed of triggers)
    links.push({
      key: `trigger:${placed.trigger.id}`,
      from: [placed.x + placed.w, placed.y + placed.h / 2],
      to: [start.x, start.y + start.h / 2],
    });
  const addTrigger = {
    x: tx + triggerWidth / 2 - SLOT / 2,
    y: count
      ? top + count * ROW - (ROW - NODE_H) / 2 + 6
      : start.y + start.h / 2 - SLOT / 2,
  };

  const right = Math.max(...nodes.map((p) => p.x + p.w));
  const bottom = Math.max(
    ...nodes.map((p) => p.y + p.h),
    ...triggers.map((t) => t.y + t.h),
    addTrigger.y + SLOT,
  );
  const topmost = Math.min(0, ...triggers.map((t) => t.y), addTrigger.y);
  if (topmost < 0) {
    const shift = -topmost + NODE_H / 2;
    for (const placed of nodes) placed.y += shift;
    for (const placed of triggers) placed.y += shift;
    addTrigger.y += shift;
    for (const link of links) {
      link.from = [link.from[0], link.from[1] + shift];
      link.to = [link.to[0], link.to[1] + shift];
    }
    return {
      nodes,
      triggers,
      addTrigger,
      links,
      width: right + 40,
      height: bottom + shift + 40,
    };
  }
  return {
    nodes,
    triggers,
    addTrigger,
    links,
    width: right + 40,
    height: bottom + 40,
  };
}

/** A horizontal S between two points, as the pasted tree's links are drawn. */
export const linkPath = (
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
) => {
  const midX = (x1 + x2) / 2;
  return `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
};
