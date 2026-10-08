import { describe, expect, it } from "vitest";
import type { ComponentNode, ProductRow } from "../../packages/contract/src";
import {
  boxOf,
  makeRoom,
  branchOf,
  DRAG_HEAT,
  LAYOUT,
  EMPTY_FILTERS,
  build,
  options,
  overlaps,
  pick,
  radius,
  simulate,
  type SimNode,
  toGraph,
  type ArchNode,
} from "../../packages/web/src/catalog/architecture";

const node = (
  id: string,
  name: string,
  product: string,
  team: string,
  parent: string | null = null,
): ComponentNode => ({
  id,
  parent_id: parent,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  name,
  description: null,
  aliases: null,
  product_slug: product,
  product_name: product.toUpperCase(),
  team_slug: team,
  team_name: team.toUpperCase(),
});

// platform ─ trace ─ printer ─ printer nozzle └ fleet ─ scanner support ─
// inkmon ─ label renderer
const ROWS: ComponentNode[] = [
  node("c1", "printer", "trace", "platform"),
  node("c2", "printer nozzle", "trace", "platform", "c1"),
  node("c3", "scanner", "fleet", "platform"),
  node("c4", "label renderer", "inkmon", "support"),
];

const kids = (n: ArchNode, path: string[]): ArchNode => {
  let at = n;
  for (const label of path) at = at.children.find((c) => c.label === label)!;
  return at;
};

describe("pick", () => {
  it("keeps everything when nothing is asked of it", () => {
    expect(pick(ROWS, EMPTY_FILTERS)).toHaveLength(4);
  });

  it("narrows by team, then by product", () => {
    expect(
      pick(ROWS, { ...EMPTY_FILTERS, team: "platform" }).map((r) => r.id),
    ).toEqual(["c1", "c2", "c3"]);
    expect(
      pick(ROWS, { ...EMPTY_FILTERS, team: "platform", product: "fleet" }).map(
        (r) => r.id,
      ),
    ).toEqual(["c3"]);
  });

  it("searches name and slug, ignoring case", () => {
    expect(
      pick(ROWS, { ...EMPTY_FILTERS, query: "NOZZLE" }).map((r) => r.id),
    ).toEqual(["c2"]);
    expect(
      pick(ROWS, { ...EMPTY_FILTERS, query: "label-renderer" }).map(
        (r) => r.id,
      ),
    ).toEqual(["c4"]);
  });
});

describe("build", () => {
  it("nests team, product and component", () => {
    const root = build(ROWS, EMPTY_FILTERS);
    expect(root.children.map((t) => t.label).sort()).toEqual([
      "PLATFORM",
      "SUPPORT",
    ]);
    const printer = kids(root, ["PLATFORM", "TRACE", "printer"]);
    expect(printer.kind).toBe("component");
    expect(printer.children.map((c) => c.label)).toEqual(["printer nozzle"]);
  });

  // A hit with no ancestors is a name floating in space: nothing says which
  // product's printer it is.
  it("drags a search hit's ancestors back in", () => {
    const root = build(ROWS, { ...EMPTY_FILTERS, query: "nozzle" });
    expect(root.children).toHaveLength(1);
    const printer = kids(root, ["PLATFORM", "TRACE", "printer"]);
    expect(printer.children.map((c) => c.label)).toEqual(["printer nozzle"]);
  });

  it("drops a team and a product with nothing left under them", () => {
    const root = build(ROWS, { ...EMPTY_FILTERS, team: "support" });
    expect(root.children.map((t) => t.label)).toEqual(["SUPPORT"]);
    expect(root.children[0].children.map((p) => p.label)).toEqual(["INKMON"]);
  });

  // Filtering to the child alone would otherwise lose it entirely. Here the
  // parent survives via withAncestors, so this checks the other direction: a
  // parent filtered out by product cannot strand its child.
  it("hangs a component off its product when its parent did not survive", () => {
    const orphan = [node("c9", "solo", "trace", "platform", "missing")];
    const root = build(orphan, EMPTY_FILTERS);
    expect(
      kids(root, ["PLATFORM", "TRACE"]).children.map((c) => c.label),
    ).toEqual(["solo"]);
  });

  it("has nothing to draw for an empty catalogue", () => {
    expect(build([], EMPTY_FILTERS).children).toEqual([]);
  });
});

describe("toGraph", () => {
  it("draws products and components, and every parent-child as a link", () => {
    const graph = toGraph(build(ROWS, EMPTY_FILTERS));
    expect(graph.nodes).toHaveLength(7);
    expect(
      graph.nodes.some((n) => n.kind === "root" || n.kind === "team"),
    ).toBe(false);
    expect(graph.links).toHaveLength(graph.nodes.length - 3);
  });

  it("leaves each product as its own island", () => {
    const graph = toGraph(build(ROWS, EMPTY_FILTERS));
    const targets = new Set(graph.links.map((l) => l.target));
    const roots = graph.nodes.filter((n) => !targets.has(n.key));
    expect(roots.map((n) => n.kind)).toEqual(["product", "product", "product"]);
  });

  it("counts depth from the product", () => {
    const graph = toGraph(build(ROWS, EMPTY_FILTERS));
    const depth = (label: string) =>
      graph.nodes.find((n) => n.label === label)!.depth;
    expect(depth("TRACE")).toBe(0);
    expect(depth("printer")).toBe(1);
    expect(depth("printer nozzle")).toBe(2);
  });

  it("links a subcomponent to its parent, not to its product", () => {
    const graph = toGraph(build(ROWS, EMPTY_FILTERS));
    const printer = graph.nodes.find((n) => n.label === "printer")!;
    const nozzle = graph.nodes.find((n) => n.label === "printer nozzle")!;
    expect(graph.links).toContainEqual({
      source: printer.key,
      target: nozzle.key,
    });
  });

  it("counts what hangs off each node, for sizing", () => {
    const graph = toGraph(build(ROWS, EMPTY_FILTERS));
    expect(graph.nodes.find((n) => n.label === "printer")!.weight).toBe(1);
    expect(graph.nodes.find((n) => n.label === "scanner")!.weight).toBe(0);
  });

  it("has nothing to draw for an empty catalogue", () => {
    const graph = toGraph(build([], EMPTY_FILTERS));
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
  });

  it("roots a team's graph at its products", () => {
    const graph = toGraph(build(ROWS, { ...EMPTY_FILTERS, team: "platform" }));
    const targets = new Set(graph.links.map((l) => l.target));
    expect(
      graph.nodes
        .filter((n) => !targets.has(n.key))
        .map((n) => n.label)
        .sort(),
    ).toEqual(["FLEET", "TRACE"]);
  });

  it("keeps the product node when filtered to one product", () => {
    const graph = toGraph(build(ROWS, { ...EMPTY_FILTERS, product: "trace" }));
    expect(graph.nodes.map((n) => n.kind)).toEqual([
      "product",
      "component",
      "component",
    ]);
  });
});

describe("simulate", () => {
  const catalogue = (): ComponentNode[] => {
    const rows: ComponentNode[] = [];
    let id = 0;
    for (const team of ["field", "integrations", "platform", "support"])
      for (const product of ["a", "b"]) {
        const tops: string[] = [];
        for (let i = 0; i < 8; i++) {
          const cid = `c${id++}`;
          rows.push(
            node(
              cid,
              `component with a long name ${cid}`,
              `${team}-${product}`,
              team,
              i >= 4 ? tops[i % 4] : null,
            ),
          );
          if (i < 4) tops.push(cid);
        }
      }
    return rows;
  };

  // Labels are horizontal and wider than their dots, so circle collision alone
  // leaves text on top of text.
  it("settles a catalogue of this size with no label on top of another", () => {
    const { nodes } = simulate(toGraph(build(catalogue(), EMPTY_FILTERS)));
    expect(nodes.length).toBeGreaterThan(70);
    expect(overlaps(nodes)).toBe(0);
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("keeps each team's island clear of the others", () => {
    const { nodes, links } = simulate(
      toGraph(build(catalogue(), EMPTY_FILTERS)),
    );
    const island = new Map<SimNode, SimNode>(nodes.map((n) => [n, n]));
    const find = (n: SimNode): SimNode =>
      island.get(n) === n ? n : find(island.get(n)!);
    for (const link of links)
      island.set(find(link.source as SimNode), find(link.target as SimNode));
    // Measured between label boxes, not centres: a long label is most of what
    // an island's edge is made of.
    let gap = Infinity;
    for (const a of nodes)
      for (const b of nodes) {
        if (find(a) === find(b)) continue;
        const boxA = boxOf(a, 0);
        const boxB = boxOf(b, 0);
        const dx = Math.max(
          b.x! - boxB.left - (a.x! + boxA.right),
          a.x! - boxA.left - (b.x! + boxB.right),
          0,
        );
        const dy = Math.max(
          b.y! - boxB.up - (a.y! + boxA.down),
          a.y! - boxA.up - (b.y! + boxB.down),
          0,
        );
        gap = Math.min(gap, Math.hypot(dx, dy));
      }
    expect(gap).toBeGreaterThan(40);
  });

  it("spreads wider than tall, to match the window it is drawn in", () => {
    const { nodes } = simulate(toGraph(build(catalogue(), EMPTY_FILTERS)));
    const xs = nodes.map((n) => n.x!);
    const ys = nodes.map((n) => n.y!);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(w / h).toBeGreaterThan(1.3);
  });

  // Obsidian's branches keep going the way they started: a node's children sit
  // further out than it does, on the side away from its own parent.
  it("puts every component further out than the node it hangs off", () => {
    const { nodes, links } = simulate(
      toGraph(build(catalogue(), EMPTY_FILTERS)),
    );
    const parent = new Map(
      links.map((l) => [l.target as SimNode, l.source as SimNode]),
    );
    const productOf = (n: SimNode): SimNode =>
      parent.has(n) ? productOf(parent.get(n)!) : n;
    const distance = (n: SimNode) => {
      const product = productOf(n);
      return Math.hypot(n.x! - product.x!, n.y! - product.y!);
    };
    let checked = 0;
    for (const n of nodes) {
      const above = parent.get(n);
      if (!above || above.kind === "product") continue;
      checked++;
      expect(distance(n)).toBeGreaterThan(distance(above));
    }
    expect(checked).toBeGreaterThan(10);
  });

  // A label pointing back towards its product runs across its siblings.
  it("faces every label away from its product", () => {
    const { nodes, links } = simulate(
      toGraph(build(catalogue(), EMPTY_FILTERS)),
    );
    const parent = new Map(
      links.map((l) => [l.target as SimNode, l.source as SimNode]),
    );
    const productOf = (n: SimNode): SimNode =>
      parent.has(n) ? productOf(parent.get(n)!) : n;
    for (const n of nodes) {
      const dx = n.x! - productOf(n).x!;
      if (n.kind === "product" || Math.abs(dx) < 20) continue;
      expect(n.side).toBe(dx < 0 ? -1 : 1);
    }
  });

  // The point of growing the rings: a product several times the size of any
  // today still comes out with no text on top of text.
  it("keeps a product with sixty components legible", () => {
    const rows: ComponentNode[] = [];
    const tops: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `big${i}`;
      rows.push(
        node(
          id,
          `a fairly long component name ${i}`,
          "big",
          "platform",
          i >= 12 ? tops[i % 12] : null,
        ),
      );
      if (i < 12) tops.push(id);
    }
    const { nodes } = simulate(toGraph(build(rows, EMPTY_FILTERS)));
    expect(nodes).toHaveLength(61);
    expect(overlaps(nodes)).toBe(0);
  });

  it("packs the islands into rows that fill a window of the asked shape", () => {
    const wide = simulate(
      toGraph(build(catalogue(), EMPTY_FILTERS)),
      LAYOUT,
      2.4,
    );
    const tall = simulate(
      toGraph(build(catalogue(), EMPTY_FILTERS)),
      LAYOUT,
      0.8,
    );
    const shape = (group: SimNode[]) => {
      const xs = group.map((n) => n.x!);
      const ys = group.map((n) => n.y!);
      return (
        (Math.max(...xs) - Math.min(...xs)) /
        (Math.max(...ys) - Math.min(...ys))
      );
    };
    expect(shape(wide.nodes)).toBeGreaterThan(shape(tall.nodes));
    expect(overlaps(wide.nodes)).toBe(0);
  });

  // The forces that shape the layout never quite agree, and left running they
  // hold the graph in a slow tremble. What runs after the first draw is at rest
  // in it.
  it("stays still once settled, even while heated for a drag", () => {
    const { sim, nodes } = simulate(toGraph(build(catalogue(), EMPTY_FILTERS)));
    const before = nodes.map((n) => [n.x!, n.y!]);
    sim.alpha(DRAG_HEAT).alphaTarget(DRAG_HEAT);
    for (let i = 0; i < 120; i++) sim.tick();
    nodes.forEach((n, i) => {
      expect(Math.hypot(n.x! - before[i][0], n.y! - before[i][1])).toBeLessThan(
        0.5,
      );
    });
  });

  it("moves the dragged branch with the drag and leaves the rest alone", () => {
    const { sim, nodes, links, hold } = simulate(
      toGraph(build(catalogue(), EMPTY_FILTERS)),
    );
    const dragged = nodes.find((n) => n.depth === 1 && n.weight > 0)!;
    const branch = new Set<SimNode>([dragged]);
    for (let grew = true; grew;) {
      grew = false;
      for (const link of links)
        if (
          branch.has(link.source as SimNode) &&
          !branch.has(link.target as SimNode)
        ) {
          branch.add(link.target as SimNode);
          grew = true;
        }
    }
    const before = new Map(nodes.map((n) => [n, [n.x!, n.y!]]));
    const moved = (n: SimNode) =>
      Math.hypot(n.x! - before.get(n)![0], n.y! - before.get(n)![1]);

    hold(dragged);
    sim.alpha(DRAG_HEAT).alphaTarget(DRAG_HEAT);
    for (let tick = 0; tick < 60; tick++) {
      dragged.fx = before.get(dragged)![0] + Math.min(tick, 10) * 0.4;
      dragged.fy = before.get(dragged)![1];
      sim.tick();
    }

    for (const n of branch)
      if (n !== dragged) expect(moved(n)).toBeGreaterThan(3);
    for (const n of nodes)
      if (!branch.has(n)) expect(moved(n)).toBeLessThan(1.5);
  });

  // Dropped onto another island: it stays where it was let go, keeps its shape,
  // and what it landed on moves aside rather than staying under it.
  it.each([0, 1, 2, 3, 4, 5])(
    "leaves a dropped branch where it was let go and clears room for it (onto island %i)",
    (which) => {
      const { sim, nodes, links, restless, hold, drop } = simulate(
        toGraph(build(catalogue(), EMPTY_FILTERS)),
      );
      const dragged = nodes.find((n) => n.depth === 1 && n.weight > 0)!;
      const branch = [...branchOf(dragged, links)];
      const target = nodes.filter(
        (n) => n.kind === "product" && n.productSlug !== dragged.productSlug,
      )[which];
      const shape = () =>
        branch.map((n) => [n.x! - dragged.x!, n.y! - dragged.y!] as const);
      const before = shape();
      const from = { x: dragged.x!, y: dragged.y! };
      const to = { x: target.x! + 20, y: target.y! + 10 };

      hold(dragged);
      sim.alpha(DRAG_HEAT).alphaTarget(DRAG_HEAT);
      for (let tick = 1; tick <= 40; tick++) {
        const progress = Math.min(1, tick / 20);
        dragged.fx = from.x + (to.x - from.x) * progress;
        dragged.fy = from.y + (to.y - from.y) * progress;
        sim.tick();
      }
      drop(dragged);
      dragged.fx = null;
      dragged.fy = null;
      hold(null);
      sim.alphaTarget(0).alpha(1);
      for (let tick = 0; tick < 600 && restless() > 0.05; tick++) sim.tick();

      expect(Math.hypot(dragged.x! - to.x, dragged.y! - to.y)).toBeLessThan(1);
      shape().forEach(([x, y], i) => {
        expect(Math.hypot(x - before[i][0], y - before[i][1])).toBeLessThan(1);
      });
      expect(overlaps(nodes)).toBe(0);
    },
  );

  it("moves nothing else when a branch is dropped into empty space", () => {
    const { nodes, links } = simulate(
      toGraph(build(catalogue(), EMPTY_FILTERS)),
    );
    const dragged = nodes.find((n) => n.depth === 1 && n.weight > 0)!;
    const branch = branchOf(dragged, links);
    const far = Math.max(...nodes.map((n) => n.y!)) + 400;
    const homes = new Map(
      nodes.map((n) => [
        n,
        { x: n.x!, y: branch.has(n) ? n.y! - dragged.y! + far : n.y! },
      ]),
    );
    const room = makeRoom(nodes, links, homes, branch);
    for (const n of nodes) expect(room.get(n)).toEqual(homes.get(n));
  });

  it("hands back a stopped simulation, so nothing moves until asked", () => {
    const { sim } = simulate(toGraph(build(ROWS, EMPTY_FILTERS)));
    expect(sim.alphaMin()).toBeGreaterThan(0.001);
  });
});

describe("radius", () => {
  it("ranks a product over its direct children over what hangs below them", () => {
    const radiusOf = (kind: "product" | "component", depth: number) =>
      radius({ key: "k", kind, label: "l", weight: 0, depth });
    expect(radiusOf("product", 0)).toBeGreaterThan(radiusOf("component", 1));
    expect(radiusOf("component", 1)).toBeGreaterThan(radiusOf("component", 2));
  });

  it("grows with what hangs off it, but not without limit", () => {
    const leaf = radius({
      key: "a",
      kind: "component",
      label: "l",
      weight: 0,
      depth: 2,
    });
    const busy = radius({
      key: "b",
      kind: "component",
      label: "l",
      weight: 4,
      depth: 2,
    });
    const huge = radius({
      key: "c",
      kind: "component",
      label: "l",
      weight: 400,
      depth: 2,
    });
    expect(busy).toBeGreaterThan(leaf);
    expect(huge - leaf).toBeLessThanOrEqual(3);
  });
});

describe("options", () => {
  const product = (slug: string, team: string): ProductRow => ({
    id: slug,
    slug,
    name: slug.toUpperCase(),
    aliases: null,
    team_slug: team,
    team_name: team.toUpperCase(),
  });
  const PRODUCTS = [
    product("trace", "platform"),
    product("fleet", "platform"),
    product("inkmon", "support"),
    product("ledger", "support"),
  ];

  it("offers every team, and only the chosen team's products", () => {
    expect(options(PRODUCTS, "").teams.map((o) => o.value)).toEqual([
      "platform",
      "support",
    ]);
    expect(options(PRODUCTS, "").products.map((o) => o.value)).toEqual([
      "fleet",
      "inkmon",
      "ledger",
      "trace",
    ]);
    expect(options(PRODUCTS, "support").products.map((o) => o.value)).toEqual([
      "inkmon",
      "ledger",
    ]);
  });
});
