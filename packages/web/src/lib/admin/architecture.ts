/**
 * The catalogue as one graph: product → component → subcomponent.
 *
 * Each product is drawn as a radial tree: its components on rings around it,
 * every branch keeping to its own wedge, labels facing outwards. After the
 * first draw a small force simulation takes over, so the graph can be
 * dragged and rearranged by hand.
 */
import type { ComponentNode } from "@tachy/contract";
import {
  forceCollide,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

export type Kind = "root" | "team" | "product" | "component";

export type ArchNode = {
  /** Unique within the tree; a component's is its own id. */
  key: string;
  kind: Kind;
  label: string;
  /** Set on components, for opening the record. */
  slug?: string;
  productSlug?: string;
  teamSlug?: string;
  children: ArchNode[];
};

export type Filters = {
  team: string;
  product: string;
  /** Matched against a component's name and slug. */
  query: string;
};

export const EMPTY_FILTERS: Filters = { team: "", product: "", query: "" };

/** Which components survive the filters, before the tree is assembled. */
export function pick(rows: ComponentNode[], f: Filters): ComponentNode[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.team || r.team_slug === f.team) &&
      (!f.product || r.product_slug === f.product) &&
      (!q ||
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q)),
  );
}

/**
 * A search hit is only legible with what it hangs off, so every match drags
 * its ancestors back in. Without this, filtering to "printer" yields a row of
 * orphans whose products nobody can name.
 */
function withAncestors(
  rows: ComponentNode[],
  all: ComponentNode[],
): ComponentNode[] {
  const byId = new Map(all.map((r) => [r.id, r]));
  const keep = new Map<string, ComponentNode>();
  for (const r of rows) {
    let at: ComponentNode | undefined = r;
    while (at && !keep.has(at.id)) {
      keep.set(at.id, at);
      at = at.parent_id ? byId.get(at.parent_id) : undefined;
    }
  }
  return [...keep.values()];
}

/**
 * Builds the tree from the rows that survived filtering. A product with no
 * surviving components is dropped, and so is a team with no surviving
 * products: an empty branch is a line to nowhere.
 */
export function build(all: ComponentNode[], f: Filters): ArchNode {
  const rows = withAncestors(pick(all, f), all);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const root: ArchNode = {
    key: "::root",
    kind: "root",
    label: "catalogue",
    children: [],
  };
  const teams = new Map<string, ArchNode>();
  const products = new Map<string, ArchNode>();
  const nodes = new Map<string, ArchNode>();

  for (const r of rows) {
    let team = teams.get(r.team_slug);
    if (!team) {
      team = {
        key: `team:${r.team_slug}`,
        kind: "team",
        label: r.team_name,
        teamSlug: r.team_slug,
        children: [],
      };
      teams.set(r.team_slug, team);
      root.children.push(team);
    }
    const pKey = `${r.team_slug}/${r.product_slug}`;
    let product = products.get(pKey);
    if (!product) {
      product = {
        key: `product:${pKey}`,
        kind: "product",
        label: r.product_name,
        productSlug: r.product_slug,
        teamSlug: r.team_slug,
        children: [],
      };
      products.set(pKey, product);
      team.children.push(product);
    }
    nodes.set(r.id, {
      key: r.id,
      kind: "component",
      label: r.name,
      slug: r.slug,
      productSlug: r.product_slug,
      teamSlug: r.team_slug,
      children: [],
    });
  }

  for (const r of rows) {
    const node = nodes.get(r.id)!;
    /* A parent outside the surviving set means the chain was broken by a
       filter, so the node hangs off its product instead of vanishing. */
    const parent =
      (r.parent_id && byId.has(r.parent_id) && nodes.get(r.parent_id)) ||
      products.get(`${r.team_slug}/${r.product_slug}`);
    parent?.children.push(node);
  }

  return root;
}

/** One drawn node. The simulation writes `x`/`y` onto its own copies. */
export type GraphNode = {
  key: string;
  kind: Kind;
  label: string;
  slug?: string;
  productSlug?: string;
  teamSlug?: string;
  /** How many hang off it, which is what sizes the dot. */
  weight: number;
  /** Steps below the product: 0 is the product, 1 hangs straight off it. */
  depth: number;
  /** Which side of the dot the label sits on: outwards from the product. */
  side?: 1 | -1;
};

export type GraphLink = { source: string; target: string };

export type Graph = { nodes: GraphNode[]; links: GraphLink[] };

/**
 * Flattens the tree into what a force simulation takes: products and their
 * components. The root and the teams are not drawn. A team hub tied every
 * product to one point and read as clutter, and the team filter already says
 * whose products these are. The result is one island per product.
 */
export function toGraph(root: ArchNode): Graph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const drawn = (n: ArchNode | null) =>
    !!n && (n.kind === "product" || n.kind === "component");

  const walk = (n: ArchNode, parent: ArchNode | null, depth: number) => {
    const here = drawn(n);
    if (here) {
      nodes.push({
        key: n.key,
        kind: n.kind,
        label: n.label,
        slug: n.slug,
        productSlug: n.productSlug,
        teamSlug: n.teamSlug,
        weight: n.children.length,
        depth,
      });
      if (drawn(parent)) links.push({ source: parent!.key, target: n.key });
    }
    for (const c of n.children) walk(c, n, here ? depth + 1 : 0);
  };
  walk(root, null, 0);

  return { nodes, links };
}

/** Dot radius: products read as hubs, their direct children as branches. */
export function radius(n: GraphNode): number {
  const base = n.kind === "product" ? 11 : n.depth === 1 ? 6.5 : 4.5;
  return base + Math.min(3, n.weight * 0.3);
}

/** Label size in graph units, which the zoom scales with everything else. */
export function labelFont(n: GraphNode): number {
  return n.kind === "product" ? 14 : n.depth === 1 ? 12 : 11;
}

/**
 * Estimated label width. Measuring text needs a layout pass per node; an
 * average advance of 0.58em is within a few pixels for the UI face.
 */
export function labelWidth(n: GraphNode): number {
  const wide = n.kind === "product" ? 0.62 : 0.58;
  return Math.ceil(n.label.length * labelFont(n) * wide);
}

/** Gap between a dot and its label. */
export const LABEL_GAP = 5;

/** The rectangle a node and its label occupy, relative to the node. */
export function boxOf(n: GraphNode, pad = 3) {
  const r = radius(n);
  const half = Math.max(r, labelFont(n) * 0.7) + pad;
  const text = r + LABEL_GAP + labelWidth(n) + pad;
  return n.side === -1
    ? { left: text, right: r + pad, up: half, down: half }
    : { left: r + pad, right: text, up: half, down: half };
}

type Placed = GraphNode & { x?: number; y?: number; vx?: number; vy?: number };

/**
 * Pushes overlapping node-plus-label rectangles apart until none overlap, or
 * `passes` runs out. Each pair moves apart along the axis where it overlaps
 * least, split between the two. The radial layout leaves little for this to
 * do; it catches the odd long label that reaches into a neighbour's wedge.
 */
export function separate(nodes: Placed[], passes = 80): void {
  const boxes = nodes.map((n) => boxOf(n));
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ba = boxes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const bb = boxes[j];
        const ax = a.x ?? 0;
        const ay = a.y ?? 0;
        const bx = b.x ?? 0;
        const by = b.y ?? 0;
        const ox =
          Math.min(ax + ba.right, bx + bb.right) -
          Math.max(ax - ba.left, bx - bb.left);
        const oy =
          Math.min(ay + ba.down, by + bb.down) -
          Math.max(ay - ba.up, by - bb.up);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy < ox) {
          const push = (oy / 2 + 0.5) * (ay <= by ? -1 : 1);
          a.y = ay + push;
          b.y = by - push;
        } else {
          const push = (ox / 2 + 0.5) * (ax <= bx ? -1 : 1);
          a.x = ax + push;
          b.x = bx - push;
        }
      }
    }
    if (!moved) return;
  }
}

/**
 * Places one product's tree around the origin.
 *
 * Every leaf gets a slot on the ring for its depth, in depth-first order, so
 * a branch keeps to one wedge; a node with children sits in the middle of
 * the wedge its leaves span. The rings are ovals. Across, each ring clears
 * the widest label on the ring inside it, because labels are horizontal and
 * face outwards; down, rings are close, because a label is only a line
 * tall. So links run long only where a label needs the room.
 *
 * Neighbouring slots are spaced for the labels actually there: far enough
 * apart vertically where the ring runs up and down, horizontally where it
 * runs across. When the leaves do not fit round the product, every ring
 * grows until they do, which is what keeps a large product legible.
 *
 * A thin sector to the right is left empty for the product's own label, so
 * no link crosses it.
 */
export function radialLayout(
  root: Placed,
  childrenOf: Map<Placed, Placed[]>,
  f: typeof LAYOUT,
): void {
  const kids = (n: Placed) => childrenOf.get(n) ?? [];
  const leaves: Placed[] = [];
  const groupOf = new Map<Placed, Placed>();
  const ring: Placed[][] = [];
  const walk = (n: Placed, group: Placed | null) => {
    if (n !== root) {
      (ring[n.depth] ??= []).push(n);
      groupOf.set(n, group ?? n);
      if (!kids(n).length) leaves.push(n);
    }
    for (const c of kids(n)) walk(c, n === root ? c : group);
  };
  walk(root, null);
  root.x = 0;
  root.y = 0;
  root.side = 1;
  if (!leaves.length) return;

  const deepest = ring.length - 1;
  const reach = (n: Placed) => radius(n) + LABEL_GAP + labelWidth(n);
  const widest = ring.map((rs, d) =>
    d === 0
      ? 0
      : Math.max(0, ...(rs ?? []).filter((n) => kids(n).length).map(reach)),
  );
  const tall = f.spacing.v;

  let grow = 1;
  let angles = new Map<Placed, number>();
  let rx: number[] = [];
  let ry: number[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    rx = [0];
    ry = [0];
    for (let d = 1; d <= deepest; d++) {
      ry[d] = (f.ring.y + (d - 1) * f.ring.stepY) * grow;
      rx[d] =
        d === 1
          ? Math.max(ry[1], radius(root) + f.ring.x * grow)
          : rx[d - 1] + widest[d - 1] + f.ring.gapX * grow;
    }
    const sector = Math.asin(
      Math.min(1, (labelFont(root) * 0.7 + tall) / ry[1]),
    );
    const room = Math.PI * 2 - 2 * sector;

    const need = (a: Placed, b: Placed, at: number) => {
      const d = Math.max(a.depth, b.depth);
      const vertical = tall / (ry[d] * Math.abs(Math.cos(at)) + 1e-6);
      const across =
        (Math.max(reach(a), reach(b)) + f.spacing.h) /
        (rx[d] * Math.abs(Math.sin(at)) + 1e-6);
      const step = Math.min(vertical, across);
      return groupOf.get(a) === groupOf.get(b) ? step : step * (1 + f.groupGap);
    };

    const steps: number[] = [0];
    let at = sector;
    for (let i = 1; i < leaves.length; i++) {
      const step = need(leaves[i - 1], leaves[i], at);
      steps.push(step);
      at += step;
    }
    const used = at - sector;
    if (used > room && attempt < 39) {
      grow *= 1.12;
      continue;
    }
    /* Slack is added to every gap equally rather than in proportion, so
       the gaps that were tight get as much of it as the loose ones and the
       leaves end up evenly spread all the way round. */
    const slack =
      leaves.length > 1 ? Math.max(0, room - used) / (leaves.length - 1) : 0;
    angles = new Map();
    let theta = leaves.length > 1 ? sector : Math.PI;
    leaves.forEach((n, i) => {
      theta += i ? steps[i] + slack : 0;
      angles.set(n, theta);
    });
    break;
  }

  const angle = (n: Placed): number => {
    const known = angles.get(n);
    if (known !== undefined) return known;
    const own = kids(n).map(angle);
    const mid = (Math.min(...own) + Math.max(...own)) / 2;
    angles.set(n, mid);
    return mid;
  };
  for (let d = 1; d <= deepest; d++)
    for (const n of ring[d] ?? []) {
      const t = angle(n);
      n.x = rx[d] * Math.cos(t);
      n.y = ry[d] * Math.sin(t);
      n.side = Math.cos(t) < 0 ? -1 : 1;
    }
}

/**
 * Lays the islands out in rows, so the whole catalogue fills a window of the
 * given aspect instead of a ring or a line. Each island keeps its shape and
 * moves as a block. Rows are filled tallest island first, then the block is
 * centred on the origin.
 */
export function packIslands(
  nodes: Placed[],
  islandOf: (n: Placed) => number,
  aspect: number,
  gap: number,
): void {
  const groups = new Map<number, Placed[]>();
  for (const n of nodes) {
    const k = islandOf(n);
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const frames = [...groups.values()].map((members) => {
    let left = Infinity;
    let right = -Infinity;
    let up = Infinity;
    let down = -Infinity;
    for (const n of members) {
      const b = boxOf(n, 0);
      left = Math.min(left, (n.x ?? 0) - b.left);
      right = Math.max(right, (n.x ?? 0) + b.right);
      up = Math.min(up, (n.y ?? 0) - b.up);
      down = Math.max(down, (n.y ?? 0) + b.down);
    }
    return { members, left, up, w: right - left, h: down - up };
  });
  if (!frames.length) return;
  frames.sort((a, b) => b.h - a.h);

  type Row = { items: typeof frames; w: number; h: number };
  const shelve = (limit: number) => {
    const rows: Row[] = [];
    for (const f of frames) {
      const row = rows[rows.length - 1];
      if (row && row.w + gap + f.w <= limit) {
        row.items.push(f);
        row.w += gap + f.w;
        row.h = Math.max(row.h, f.h);
      } else rows.push({ items: [f], w: f.w, h: f.h });
    }
    const w = Math.max(...rows.map((r) => r.w));
    const h = rows.reduce((sum, r) => sum + r.h, 0) + gap * (rows.length - 1);
    return { rows, w, h };
  };

  /* Islands vary too much in shape for one guessed row width: long labels
     make some several times wider than tall. Every width from one island per
     row to all in one row is tried, and the arrangement that needs the
     window scaled down least wins. */
  const byWidth = [...frames].sort((a, b) => b.w - a.w);
  let best = shelve(Infinity);
  let limit = 0;
  for (const f of byWidth) {
    limit += (limit ? gap : 0) + f.w;
    const tried = shelve(limit);
    if (Math.max(tried.w / aspect, tried.h) < Math.max(best.w / aspect, best.h))
      best = tried;
  }
  const rows = best.rows;

  const total = best.h;
  let y = -total / 2;
  for (const row of rows) {
    let x = -row.w / 2;
    for (const f of row.items) {
      const dx = x - f.left;
      const dy = y + (row.h - f.h) / 2 - f.up;
      for (const n of f.members) {
        n.x = (n.x ?? 0) + dx;
        n.y = (n.y ?? 0) + dy;
      }
      x += f.w + gap;
    }
    y += row.h + gap;
  }
}

/** Whether any two node-plus-label rectangles overlap, for tests and checks. */
export function overlaps(nodes: Placed[]): number {
  let count = 0;
  const boxes = nodes.map((n) => boxOf(n, 0));
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const [a, b, ba, bb] = [nodes[i], nodes[j], boxes[i], boxes[j]];
      const ox =
        Math.min((a.x ?? 0) + ba.right, (b.x ?? 0) + bb.right) -
        Math.max((a.x ?? 0) - ba.left, (b.x ?? 0) - bb.left);
      const oy =
        Math.min((a.y ?? 0) + ba.down, (b.y ?? 0) + bb.down) -
        Math.max((a.y ?? 0) - ba.up, (b.y ?? 0) - bb.up);
      if (ox > 0 && oy > 0) count++;
    }
  return count;
}

/** Everything a filter row needs to offer, narrowed by what is above it. */
export function options(rows: ComponentNode[], team: string) {
  const teams = new Map<string, string>();
  const products = new Map<string, string>();
  for (const r of rows) {
    teams.set(r.team_slug, r.team_name);
    if (!team || r.team_slug === team)
      products.set(r.product_slug, r.product_name);
  }
  const sorted = (m: Map<string, string>) =>
    [...m].sort((a, b) => a[1].localeCompare(b[1]));
  return {
    teams: sorted(teams).map(([value, label]) => ({ value, label })),
    products: sorted(products).map(([value, label]) => ({ value, label })),
  };
}

export type SimNode = GraphNode & SimulationNodeDatum;
export type SimLink = SimulationLinkDatum<SimNode>;

/**
 * The forces that run after the first draw: each child holding its offset
 * from its parent, circle collision, and a spring back to each node's home.
 * All three are zero at rest, so nothing moves until something is dragged,
 * a drag moves the dragged node's branch, and its neighbours ease aside
 * only if it touches them.
 */
export function holdStill(
  sim: Simulation<SimNode, SimLink>,
  links: SimLink[],
  f: { home: number; follow: number; friction: number },
): {
  restless: () => number;
  hold: (n: SimNode | null) => void;
  drop: (n: SimNode) => void;
} {
  const nodes = sim.nodes();
  const at = new Map(nodes.map((n) => [n, { x: n.x ?? 0, y: n.y ?? 0 }]));
  const follow = forceFollow(links, f.follow);
  for (const n of nodes) {
    n.vx = 0;
    n.vy = 0;
  }
  sim
    .velocityDecay(f.friction)
    .force("follow", follow)
    .force(
      "home",
      forceHome(at, f.home, (n) => held.has(n)),
    );

  const held = new Set<SimNode>();
  const hold = (n: SimNode | null) => {
    held.clear();
    if (n) for (const m of branchOf(n, links)) held.add(m);
  };

  /* Where a dropped branch lands is where it lives now: its homes move with
     it, whatever it landed on is moved aside, and the springs carry every
     node to its new home rather than it jumping there. */
  const drop = (n: SimNode) => {
    const was = at.get(n)!;
    const dx = (n.x ?? 0) - was.x;
    const dy = (n.y ?? 0) - was.y;
    const branch = branchOf(n, links);
    for (const m of branch) {
      const h = at.get(m)!;
      at.set(m, { x: h.x + dx, y: h.y + dy });
    }
    for (const [m, h] of makeRoom(nodes, links, at, branch)) at.set(m, h);
    follow.rebase(at);
  };

  const restless = () => {
    let most = 0;
    for (const n of nodes) {
      const h = at.get(n)!;
      most = Math.max(
        most,
        Math.abs(n.vx ?? 0),
        Math.abs(n.vy ?? 0),
        Math.hypot((n.x ?? 0) - h.x, (n.y ?? 0) - h.y),
      );
    }
    return most;
  };
  return { restless, hold, drop };
}

/**
 * How far to move `b` to clear `a`, heading away from the drop at (cx, cy)
 * rather than away from `a`. Every push then runs outwards from the drop, so
 * a node moved aside can never be pushed back into it by a later one.
 */
function awayFrom(
  cx: number,
  cy: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  ox: number,
  oy: number,
): { x: number; y: number } {
  let ux = b.x - cx;
  let uy = b.y - cy;
  const len = Math.hypot(ux, uy);
  if (len < 1e-6) return { x: 0, y: oy };
  ux /= len;
  uy /= len;
  const tx =
    (b.x - a.x) * ux > 0 && Math.abs(ux) > 1e-3 ? ox / Math.abs(ux) : Infinity;
  const ty =
    (b.y - a.y) * uy > 0 && Math.abs(uy) > 1e-3 ? oy / Math.abs(uy) : Infinity;
  let t = Math.min(tx, ty);
  if (!Number.isFinite(t))
    t =
      Math.min(
        ox / Math.max(Math.abs(ux), 1e-3),
        oy / Math.max(Math.abs(uy), 1e-3),
      ) + 1;
  return { x: ux * t, y: uy * t };
}

/** A node and everything that hangs below it. */
export function branchOf<N extends SimNode>(n: N, links: SimLink[]): Set<N> {
  const out = new Set<N>([n]);
  for (let grew = true; grew;) {
    grew = false;
    for (const l of links)
      if (out.has(l.source as N) && !out.has(l.target as N)) {
        out.add(l.target as N);
        grew = true;
      }
  }
  return out;
}

/**
 * New homes that clear a dropped branch. Anything whose label box overlaps
 * the branch is moved out of it, away from where it landed, taking its own
 * branch with it, and whatever that lands on is moved in turn. A node moved earlier
 * outranks one moved later, so the ripple runs outwards; two moved in the
 * same round settle it between themselves. The branch
 * itself never moves: it is where the person put it.
 */
export function makeRoom(
  nodes: SimNode[],
  links: SimLink[],
  homes: Map<SimNode, { x: number; y: number }>,
  pinned: Set<SimNode>,
  gap = 8,
  passes = 60,
): Map<SimNode, { x: number; y: number }> {
  const at = new Map([...homes].map(([n, h]) => [n, { ...h }]));
  const rank = new Map<SimNode, number>([...pinned].map((n) => [n, 0]));
  const boxes = new Map(nodes.map((n) => [n, boxOf(n, gap / 2)]));
  let cx = 0;
  let cy = 0;
  for (const n of pinned) {
    cx += at.get(n)!.x / pinned.size;
    cy += at.get(n)!.y / pinned.size;
  }

  for (let pass = 1; pass <= passes; pass++) {
    let moved = false;
    for (const a of nodes) {
      const ra = rank.get(a);
      if (ra === undefined) continue;
      const pa = at.get(a)!;
      const ba = boxes.get(a)!;
      for (const b of nodes) {
        if (a === b) continue;
        const rb = rank.get(b);
        if (rb !== undefined && (rb < ra || rb === 0)) continue;
        const pb = at.get(b)!;
        const bb = boxes.get(b)!;
        const ox =
          Math.min(pa.x + ba.right, pb.x + bb.right) -
          Math.max(pa.x - ba.left, pb.x - bb.left);
        const oy =
          Math.min(pa.y + ba.down, pb.y + bb.down) -
          Math.max(pa.y - ba.up, pb.y - bb.up);
        if (ox <= 0 || oy <= 0) continue;
        const shift = awayFrom(cx, cy, pa, pb, ox, oy);
        const carried = branchOf(b, links);
        const group = [...carried].some((m) => rank.has(m) && m !== b)
          ? [b]
          : [...carried];
        for (const m of group) {
          const h = at.get(m)!;
          at.set(m, { x: h.x + shift.x, y: h.y + shift.y });
          if (!rank.has(m)) rank.set(m, pass);
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return at;
}

/**
 * A spring from each node to where it settled. Unlike d3's positioning
 * forces it does not weaken as the simulation cools, so a released node
 * travels all the way home instead of stalling wherever the heat ran out.
 */
export function forceHome(
  at: Map<SimNode, { x: number; y: number }>,
  k: number,
  exempt: (n: SimNode) => boolean = () => false,
) {
  let nodes: SimNode[] = [];
  function force() {
    for (const n of nodes) {
      const h = at.get(n);
      if (!h || n.fx != null || exempt(n)) continue;
      n.vx = (n.vx ?? 0) + (h.x - (n.x ?? 0)) * k;
      n.vy = (n.vy ?? 0) + (h.y - (n.y ?? 0)) * k;
    }
  }
  force.initialize = (ns: SimNode[]) => {
    nodes = ns;
  };
  return force;
}

/**
 * Keeps each child where it settled relative to its parent, pulling only the
 * child. A branch follows the node it hangs off, rigidly and without
 * swinging round, and a parent is never tugged by what hangs below it.
 */
export function forceFollow(links: SimLink[], strength = 0.25) {
  let rest = links.map((l) => {
    const s = l.source as SimNode;
    const t = l.target as SimNode;
    return {
      s,
      t,
      dx: (t.x ?? 0) - (s.x ?? 0),
      dy: (t.y ?? 0) - (s.y ?? 0),
    };
  });

  function force() {
    for (const { s, t, dx, dy } of rest) {
      if (t.fx != null) continue;
      t.vx = (t.vx ?? 0) + ((s.x ?? 0) + dx - (t.x ?? 0)) * strength;
      t.vy = (t.vy ?? 0) + ((s.y ?? 0) + dy - (t.y ?? 0)) * strength;
    }
  }

  /** Takes each child's offset from the given homes instead of from where it settled. */
  force.rebase = (homes: Map<SimNode, { x: number; y: number }>) => {
    rest = rest.map(({ s, t }) => {
      const hs = homes.get(s)!;
      const ht = homes.get(t)!;
      return { s, t, dx: ht.x - hs.x, dy: ht.y - hs.y };
    });
  };

  return force;
}

/**
 * How hot a drag runs the simulation. Enough for the dragged node's branch to
 * follow it, low enough that its neighbours ease aside instead of jumping.
 */
export const DRAG_HEAT = 0.08;

/**
 * Motion below this alpha is too small to see, so the timer stops there
 * rather than at d3's default of 0.001.
 */
export const ALPHA_MIN = 0.02;

/**
 * Spacing for the radial layout, in graph units. `ring` sets the first
 * ring's radius and how far each further ring sits down and across; across
 * it also clears the widest label on the ring inside. `spacing` is the gap
 * kept between neighbouring labels, and `groupGap` widens it between two
 * different branches of the same product, so branches read as groups.
 */
export const LAYOUT = {
  ring: { x: 70, y: 58, stepY: 44, gapX: 22 },
  spacing: { v: 24, h: 14 },
  groupGap: 0.6,
  islandGap: 50,
  still: { home: 0.03, follow: 0.1, friction: 0.35 },
};

/**
 * The graph the map draws, laid out and stopped. The caller owns the timer
 * from here: `restart()` it for a drag.
 */
export function simulate(
  graph: Graph,
  f: typeof LAYOUT = LAYOUT,
  aspect = 2,
): {
  sim: Simulation<SimNode, SimLink>;
  nodes: SimNode[];
  links: SimLink[];
  /** The largest speed or distance from home of any node; near zero at rest. */
  restless: () => number;
  /** Frees a node's branch from the pull home while it is dragged; `null` releases it. */
  hold: (n: SimNode | null) => void;
  /** Makes where a dragged node was let go its home, and moves aside what it landed on. */
  drop: (n: SimNode) => void;
} {
  const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const links: SimLink[] = graph.links
    .map((l) => ({
      source: byKey.get(l.source)!,
      target: byKey.get(l.target)!,
    }))
    .filter((l) => l.source && l.target);

  const childrenOf = new Map<Placed, Placed[]>();
  const parentOf = new Map<SimNode, SimNode>();
  for (const l of links) {
    const p = l.source as SimNode;
    const c = l.target as SimNode;
    childrenOf.set(p, [...(childrenOf.get(p) ?? []), c]);
    parentOf.set(c, p);
  }
  const roots = nodes.filter((n) => !parentOf.has(n));
  const islandOf = new Map<SimNode, number>();
  roots.forEach((r, i) => {
    for (const n of branchOf(r, links)) islandOf.set(n, i);
    radialLayout(r, childrenOf, f);
  });
  for (let i = 0; i < roots.length; i++)
    separate(nodes.filter((n) => islandOf.get(n) === i));
  packIslands(
    nodes,
    (n) => islandOf.get(n as SimNode) ?? 0,
    aspect,
    f.islandGap,
  );

  const sim = forceSimulation<SimNode, SimLink>(nodes)
    .force("collide", forceCollide<SimNode>((d) => radius(d) + 6).strength(0.9))
    .alpha(0)
    .stop();
  const { restless, hold, drop } = holdStill(sim, links, f.still);
  sim.alphaMin(ALPHA_MIN);
  return { sim, nodes, links, restless, hold, drop };
}
