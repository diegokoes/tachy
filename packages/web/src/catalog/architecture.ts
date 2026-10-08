/**
 * The catalogue as one graph: product → component → subcomponent.
 *
 * Each product is drawn as a radial tree: its components on rings around it,
 * every branch keeping to its own wedge, labels facing outwards. After the
 * first draw a small force simulation takes over, so the graph can be
 * dragged and rearranged by hand.
 */
import type { ComponentNode, ProductRow } from "@tachy/contract";
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
export function pick(rows: ComponentNode[], filters: Filters): ComponentNode[] {
  const needle = filters.query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!filters.team || r.team_slug === filters.team) &&
      (!filters.product || r.product_slug === filters.product) &&
      (!needle ||
        r.name.toLowerCase().includes(needle) ||
        r.slug.toLowerCase().includes(needle)),
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
  for (const row of rows) {
    let at: ComponentNode | undefined = row;
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
export function build(all: ComponentNode[], filters: Filters): ArchNode {
  const rows = withAncestors(pick(all, filters), all);
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

  for (const row of rows) {
    let team = teams.get(row.team_slug);
    if (!team) {
      team = {
        key: `team:${row.team_slug}`,
        kind: "team",
        label: row.team_name,
        teamSlug: row.team_slug,
        children: [],
      };
      teams.set(row.team_slug, team);
      root.children.push(team);
    }
    const pKey = `${row.team_slug}/${row.product_slug}`;
    let product = products.get(pKey);
    if (!product) {
      product = {
        key: `product:${pKey}`,
        kind: "product",
        label: row.product_name,
        productSlug: row.product_slug,
        teamSlug: row.team_slug,
        children: [],
      };
      products.set(pKey, product);
      team.children.push(product);
    }
    nodes.set(row.id, {
      key: row.id,
      kind: "component",
      label: row.name,
      slug: row.slug,
      productSlug: row.product_slug,
      teamSlug: row.team_slug,
      children: [],
    });
  }

  for (const row of rows) {
    const node = nodes.get(row.id)!;
    // A parent outside the surviving set means the chain was broken by a
    // filter, so the node hangs off its product instead of vanishing.
    const parent =
      (row.parent_id && byId.has(row.parent_id) && nodes.get(row.parent_id)) ||
      products.get(`${row.team_slug}/${row.product_slug}`);
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
 * components, one island per product. The root and the teams are not drawn: a
 * team hub would tie every product to one point, and the team filter already
 * says whose products these are.
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
    for (const child of n.children) walk(child, n, here ? depth + 1 : 0);
  };
  walk(root, null, 0);

  return { nodes, links };
}

/** Sizes by rank: a product, its direct children, everything deeper. */
const DOT_RADIUS = [11, 6.5, 4.5];
const LABEL_FONT = [14, 12, 11];
const sizeRank = (n: GraphNode) => {
  if (n.kind === "product") return 0;
  return n.depth === 1 ? 1 : 2;
};

/** Dot radius: products read as hubs, their direct children as branches. */
export function radius(n: GraphNode): number {
  return DOT_RADIUS[sizeRank(n)] + Math.min(3, n.weight * 0.3);
}

/** Label size in graph units, which the zoom scales with everything else. */
export function labelFont(n: GraphNode): number {
  return LABEL_FONT[sizeRank(n)];
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
      const boxA = boxes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const boxB = boxes[j];
        const ax = a.x ?? 0;
        const ay = a.y ?? 0;
        const bx = b.x ?? 0;
        const by = b.y ?? 0;
        const ox =
          Math.min(ax + boxA.right, bx + boxB.right) -
          Math.max(ax - boxA.left, bx - boxB.left);
        const oy =
          Math.min(ay + boxA.down, by + boxB.down) -
          Math.max(ay - boxA.up, by - boxB.up);
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

const LAYOUT_ATTEMPTS = 40;

/**
 * Places one product's tree around the origin. Each leaf gets a slot on its
 * depth's ring in depth-first order, so a branch keeps to one wedge with its
 * parent in the middle. The rings are ovals, wide enough to clear the labels of
 * the ring inside. Every ring grows when the leaves do not fit. A thin sector
 * on the right is left for the product's label.
 */
export function radialLayout(
  root: Placed,
  childrenOf: Map<Placed, Placed[]>,
  layout: typeof LAYOUT,
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
    for (const child of kids(n)) walk(child, n === root ? child : group);
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
  const tall = layout.spacing.v;

  let grow = 1;
  let angles = new Map<Placed, number>();
  let rx: number[] = [];
  let ry: number[] = [];
  for (let attempt = 0; attempt < LAYOUT_ATTEMPTS; attempt++) {
    rx = [0];
    ry = [0];
    for (let depth = 1; depth <= deepest; depth++) {
      ry[depth] = (layout.ring.y + (depth - 1) * layout.ring.stepY) * grow;
      rx[depth] =
        depth === 1
          ? Math.max(ry[1], radius(root) + layout.ring.x * grow)
          : rx[depth - 1] + widest[depth - 1] + layout.ring.gapX * grow;
    }
    const sector = Math.asin(
      Math.min(1, (labelFont(root) * 0.7 + tall) / ry[1]),
    );
    const room = Math.PI * 2 - 2 * sector;

    const need = (a: Placed, b: Placed, at: number) => {
      const depth = Math.max(a.depth, b.depth);
      const vertical = tall / (ry[depth] * Math.abs(Math.cos(at)) + 1e-6);
      const across =
        (Math.max(reach(a), reach(b)) + layout.spacing.h) /
        (rx[depth] * Math.abs(Math.sin(at)) + 1e-6);
      const step = Math.min(vertical, across);
      return groupOf.get(a) === groupOf.get(b)
        ? step
        : step * (1 + layout.groupGap);
    };

    const steps: number[] = [0];
    let at = sector;
    for (let i = 1; i < leaves.length; i++) {
      const step = need(leaves[i - 1], leaves[i], at);
      steps.push(step);
      at += step;
    }
    const used = at - sector;
    if (used > room && attempt < LAYOUT_ATTEMPTS - 1) {
      grow *= 1.12;
      continue;
    }
    // Slack is added to every gap equally, not in proportion, so tight gaps get
    // as much as loose ones and the leaves end up evenly spread all the way
    // round.
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
  for (let depth = 1; depth <= deepest; depth++)
    for (const n of ring[depth] ?? []) {
      const bearing = angle(n);
      n.x = rx[depth] * Math.cos(bearing);
      n.y = ry[depth] * Math.sin(bearing);
      n.side = Math.cos(bearing) < 0 ? -1 : 1;
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
    const island = islandOf(n);
    groups.set(island, [...(groups.get(island) ?? []), n]);
  }
  const frames = [...groups.values()].map((members) => {
    let left = Infinity;
    let right = -Infinity;
    let up = Infinity;
    let down = -Infinity;
    for (const n of members) {
      const box = boxOf(n, 0);
      left = Math.min(left, (n.x ?? 0) - box.left);
      right = Math.max(right, (n.x ?? 0) + box.right);
      up = Math.min(up, (n.y ?? 0) - box.up);
      down = Math.max(down, (n.y ?? 0) + box.down);
    }
    return { members, left, up, w: right - left, h: down - up };
  });
  if (!frames.length) return;
  frames.sort((a, b) => b.h - a.h);

  type Row = { items: typeof frames; w: number; h: number };
  const shelve = (limit: number) => {
    const rows: Row[] = [];
    for (const frame of frames) {
      const row = rows[rows.length - 1];
      if (row && row.w + gap + frame.w <= limit) {
        row.items.push(frame);
        row.w += gap + frame.w;
        row.h = Math.max(row.h, frame.h);
      } else rows.push({ items: [frame], w: frame.w, h: frame.h });
    }
    const w = Math.max(...rows.map((r) => r.w));
    const h = rows.reduce((sum, r) => sum + r.h, 0) + gap * (rows.length - 1);
    return { rows, w, h };
  };

  // Islands vary too much in shape for one guessed row width: long labels make
  // some several times wider than tall. Every width from one island per row to
  // all in one row is tried, and the least scaled-down wins.
  const byWidth = [...frames].sort((a, b) => b.w - a.w);
  let best = shelve(Infinity);
  let limit = 0;
  for (const frame of byWidth) {
    limit += (limit ? gap : 0) + frame.w;
    const tried = shelve(limit);
    if (Math.max(tried.w / aspect, tried.h) < Math.max(best.w / aspect, best.h))
      best = tried;
  }
  const rows = best.rows;

  const total = best.h;
  let y = -total / 2;
  for (const row of rows) {
    let x = -row.w / 2;
    for (const frame of row.items) {
      const dx = x - frame.left;
      const dy = y + (row.h - frame.h) / 2 - frame.up;
      for (const n of frame.members) {
        n.x = (n.x ?? 0) + dx;
        n.y = (n.y ?? 0) + dy;
      }
      x += frame.w + gap;
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
      const [a, b, boxA, boxB] = [nodes[i], nodes[j], boxes[i], boxes[j]];
      const ox =
        Math.min((a.x ?? 0) + boxA.right, (b.x ?? 0) + boxB.right) -
        Math.max((a.x ?? 0) - boxA.left, (b.x ?? 0) - boxB.left);
      const oy =
        Math.min((a.y ?? 0) + boxA.down, (b.y ?? 0) + boxB.down) -
        Math.max((a.y ?? 0) - boxA.up, (b.y ?? 0) - boxB.up);
      if (ox > 0 && oy > 0) count++;
    }
  return count;
}

/** Everything a filter row needs to offer, narrowed by what is above it. */
export function options(products: ProductRow[], team: string) {
  const teams = new Map<string, string>();
  const named = new Map<string, string>();
  for (const product of products) {
    teams.set(product.team_slug, product.team_name);
    if (!team || product.team_slug === team)
      named.set(product.slug, product.name);
  }
  const sorted = (m: Map<string, string>) =>
    [...m].sort((a, b) => a[1].localeCompare(b[1]));
  return {
    teams: sorted(teams).map(([value, label]) => ({ value, label })),
    products: sorted(named).map(([value, label]) => ({ value, label })),
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
  strength: { home: number; follow: number; friction: number },
): {
  restless: () => number;
  hold: (n: SimNode | null) => void;
  drop: (n: SimNode) => void;
} {
  const nodes = sim.nodes();
  const at = new Map(nodes.map((n) => [n, { x: n.x ?? 0, y: n.y ?? 0 }]));
  const follow = forceFollow(links, strength.follow);
  for (const n of nodes) {
    n.vx = 0;
    n.vy = 0;
  }
  sim
    .velocityDecay(strength.friction)
    .force("follow", follow)
    .force(
      "home",
      forceHome(at, strength.home, (n) => held.has(n)),
    );

  const held = new Set<SimNode>();
  const hold = (n: SimNode | null) => {
    held.clear();
    if (n) for (const member of branchOf(n, links)) held.add(member);
  };

  // Where a dropped branch lands is where it lives now: its homes move with it,
  // whatever it landed on is moved aside, and the springs carry every node to
  // its new home rather than it jumping there.
  const drop = (n: SimNode) => {
    const was = at.get(n)!;
    const dx = (n.x ?? 0) - was.x;
    const dy = (n.y ?? 0) - was.y;
    const branch = branchOf(n, links);
    for (const member of branch) {
      const home = at.get(member)!;
      at.set(member, { x: home.x + dx, y: home.y + dy });
    }
    for (const [member, home] of makeRoom(nodes, links, at, branch))
      at.set(member, home);
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

const MIN_LENGTH = 1e-6;
const MIN_COMPONENT = 1e-3;

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
  const length = Math.hypot(ux, uy);
  if (length < MIN_LENGTH) return { x: 0, y: oy };
  ux /= length;
  uy /= length;
  const tx =
    (b.x - a.x) * ux > 0 && Math.abs(ux) > MIN_COMPONENT
      ? ox / Math.abs(ux)
      : Infinity;
  const ty =
    (b.y - a.y) * uy > 0 && Math.abs(uy) > MIN_COMPONENT
      ? oy / Math.abs(uy)
      : Infinity;
  let t = Math.min(tx, ty);
  if (!Number.isFinite(t))
    t =
      Math.min(
        ox / Math.max(Math.abs(ux), MIN_COMPONENT),
        oy / Math.max(Math.abs(uy), MIN_COMPONENT),
      ) + 1;
  return { x: ux * t, y: uy * t };
}

/** A node and everything that hangs below it. */
export function branchOf<N extends SimNode>(n: N, links: SimLink[]): Set<N> {
  const branch = new Set<N>([n]);
  for (let grew = true; grew;) {
    grew = false;
    for (const link of links)
      if (branch.has(link.source as N) && !branch.has(link.target as N)) {
        branch.add(link.target as N);
        grew = true;
      }
  }
  return branch;
}

/**
 * New homes that clear a dropped branch. Anything whose label box overlaps the
 * branch is moved out of it, away from where it landed, taking its own branch
 * with it, and whatever that lands on is moved in turn. A node moved sooner
 * outranks one moved later, so the ripple runs outwards. The branch itself
 * never moves: it is where the person put it.
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
      const rankA = rank.get(a);
      if (rankA === undefined) continue;
      const atA = at.get(a)!;
      const boxA = boxes.get(a)!;
      for (const b of nodes) {
        if (a === b) continue;
        const rankB = rank.get(b);
        if (rankB !== undefined && (rankB < rankA || rankB === 0)) continue;
        const atB = at.get(b)!;
        const boxB = boxes.get(b)!;
        const ox =
          Math.min(atA.x + boxA.right, atB.x + boxB.right) -
          Math.max(atA.x - boxA.left, atB.x - boxB.left);
        const oy =
          Math.min(atA.y + boxA.down, atB.y + boxB.down) -
          Math.max(atA.y - boxA.up, atB.y - boxB.up);
        if (ox <= 0 || oy <= 0) continue;
        const shift = awayFrom(cx, cy, atA, atB, ox, oy);
        const carried = branchOf(b, links);
        const group = [...carried].some((m) => rank.has(m) && m !== b)
          ? [b]
          : [...carried];
        for (const member of group) {
          const home = at.get(member)!;
          at.set(member, { x: home.x + shift.x, y: home.y + shift.y });
          if (!rank.has(member)) rank.set(member, pass);
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
  strength: number,
  exempt: (n: SimNode) => boolean = () => false,
) {
  let nodes: SimNode[] = [];
  function force() {
    for (const n of nodes) {
      const home = at.get(n);
      if (!home || n.fx != null || exempt(n)) continue;
      n.vx = (n.vx ?? 0) + (home.x - (n.x ?? 0)) * strength;
      n.vy = (n.vy ?? 0) + (home.y - (n.y ?? 0)) * strength;
    }
  }
  force.initialize = (given: SimNode[]) => {
    nodes = given;
  };
  return force;
}

/**
 * Keeps each child where it settled relative to its parent, pulling only the
 * child. A branch follows the node it hangs off, rigidly and without
 * swinging round, and a parent is never tugged by what hangs below it.
 */
export function forceFollow(links: SimLink[], strength = 0.25) {
  let rest = links.map((link) => {
    const parent = link.source as SimNode;
    const child = link.target as SimNode;
    return {
      parent,
      child,
      dx: (child.x ?? 0) - (parent.x ?? 0),
      dy: (child.y ?? 0) - (parent.y ?? 0),
    };
  });

  function force() {
    for (const { parent, child, dx, dy } of rest) {
      if (child.fx != null) continue;
      child.vx =
        (child.vx ?? 0) + ((parent.x ?? 0) + dx - (child.x ?? 0)) * strength;
      child.vy =
        (child.vy ?? 0) + ((parent.y ?? 0) + dy - (child.y ?? 0)) * strength;
    }
  }

  // Takes each child's offset from the given homes instead of from where it
  // settled.
  force.rebase = (homes: Map<SimNode, { x: number; y: number }>) => {
    rest = rest.map(({ parent, child }) => {
      const from = homes.get(parent)!;
      const to = homes.get(child)!;
      return { parent, child, dx: to.x - from.x, dy: to.y - from.y };
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
  layout: typeof LAYOUT = LAYOUT,
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
  for (const link of links) {
    const parent = link.source as SimNode;
    const child = link.target as SimNode;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
    parentOf.set(child, parent);
  }
  const roots = nodes.filter((n) => !parentOf.has(n));
  const islandOf = new Map<SimNode, number>();
  roots.forEach((root, i) => {
    for (const n of branchOf(root, links)) islandOf.set(n, i);
    radialLayout(root, childrenOf, layout);
  });
  for (let i = 0; i < roots.length; i++)
    separate(nodes.filter((n) => islandOf.get(n) === i));
  packIslands(
    nodes,
    (n) => islandOf.get(n as SimNode) ?? 0,
    aspect,
    layout.islandGap,
  );

  const sim = forceSimulation<SimNode, SimLink>(nodes)
    .force("collide", forceCollide<SimNode>((d) => radius(d) + 6).strength(0.9))
    .alpha(0)
    .stop();
  const { restless, hold, drop } = holdStill(sim, links, layout.still);
  sim.alphaMin(ALPHA_MIN);
  return { sim, nodes, links, restless, hold, drop };
}
