<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ComponentNode } from "@tachy/contract";
  import type { Simulation } from "d3-force";
  import { EmptyState } from "../tui";
  import { measureBox } from "../tui/fit";
  import {
    ALPHA_MIN,
    DRAG_HEAT,
    LAYOUT,
    LABEL_GAP,
    boxOf,
    build,
    labelFont,
    radius,
    simulate,
    toGraph,
    type Filters,
    type GraphNode,
    type SimLink,
    type SimNode,
  } from "./architecture";

  let {
    rows,
    filters,
    onpick,
  }: {
    rows: ComponentNode[];
    filters: Filters;
    /** Opens one component's record. Products are not editable here. */
    onpick: (node: GraphNode) => void;
  } = $props();

  const graph = $derived(toGraph(build(rows, filters)));

  let bw = $state(0);
  let bh = $state(0);
  let tx = $state(0);
  let ty = $state(0);
  let zoom = $state(1);
  let panning = $state(false);

  /* Where the view is heading. Wheel and refit move these, and a frame loop
     eases the drawn transform towards them, so a zoom glides instead of
     jumping one notch at a time. */
  let goal = { zoom: 1, tx: 0, ty: 0 };
  let frame = 0;
  let last = 0;

  type Dot = {
    key: string;
    kind: GraphNode["kind"];
    label: string;
    depth: number;
    r: number;
    fs: number;
    x: number;
    y: number;
    side: 1 | -1;
  };
  /* Plain numbers in $state.raw: d3 mutates its node objects in place, and
     deep-proxying them on every tick is too slow to animate. */
  let placed = $state.raw<Dot[]>([]);
  let edges = $state.raw<
    { key: string; x1: number; y1: number; x2: number; y2: number }[]
  >([]);

  let surface = $state<HTMLElement>();
  let sim: Simulation<SimNode, SimLink> | undefined;
  let hold: (n: SimNode | null) => void = () => {};
  let drop: (n: SimNode) => void = () => {};
  let byKey = new Map<string, SimNode>();
  let dragged: SimNode | null = null;
  let refit = false;
  let from = { x: 0, y: 0 };
  let moved = false;
  const SLOP = 4;
  /** Below this speed and distance from home, in graph units, nothing is moving. */
  const REST = 0.05;

  const shape = $derived(graph.nodes.map((n) => n.key).join(","));

  /** Returns what it drew, so `fit` never reads `placed` inside the effect. */
  function publish(nodes: SimNode[], links: SimLink[]): Dot[] {
    const dots = nodes.map((n) => ({
      key: n.key,
      kind: n.kind,
      label: n.label,
      depth: n.depth,
      side: n.side ?? 1,
      r: radius(n),
      fs: labelFont(n),
      x: n.x ?? 0,
      y: n.y ?? 0,
    }));
    placed = dots;
    edges = links.map((l) => {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      return {
        key: `${s.key}->${t.key}`,
        x1: s.x ?? 0,
        y1: s.y ?? 0,
        x2: t.x ?? 0,
        y2: t.y ?? 0,
      };
    });
    return dots;
  }

  /* The first layout settles synchronously and is drawn once. Later motion
     runs on d3's timer, which only runs during a drag and the ease back. */
  $effect(() => {
    shape;
    sim?.stop();
    if (!graph.nodes.length) {
      placed = [];
      edges = [];
      return;
    }
    const made = simulate(graph, LAYOUT, bw && bh ? bw / bh : 2);
    sim = made.sim;
    hold = made.hold;
    drop = made.drop;
    byKey = new Map(made.nodes.map((n) => [n.key, n]));
    fit(publish(made.nodes, made.links));
    sim.on("tick", () => {
      publish(made.nodes, made.links);
      if (!dragged && !refit && made.restless() < REST) sim?.stop();
    });
    sim.on("end", () => {
      if (!refit) return;
      refit = false;
      fit(publish(made.nodes, made.links), true);
    });
    return () => sim?.stop();
  });

  onDestroy(() => {
    sim?.stop();
    cancelAnimationFrame(frame);
  });

  const EASE_MS = 90;

  function glide(now: number) {
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    const k = 1 - Math.exp(-dt / EASE_MS);
    zoom += (goal.zoom - zoom) * k;
    tx += (goal.tx - tx) * k;
    ty += (goal.ty - ty) * k;
    const done =
      Math.abs(goal.zoom - zoom) < 1e-4 * goal.zoom &&
      Math.abs(goal.tx - tx) < 0.1 &&
      Math.abs(goal.ty - ty) < 0.1;
    if (done) {
      zoom = goal.zoom;
      tx = goal.tx;
      ty = goal.ty;
      frame = 0;
      last = 0;
      return;
    }
    frame = requestAnimationFrame(glide);
  }

  function steer(to: { zoom: number; tx: number; ty: number }) {
    goal = to;
    if (!frame) frame = requestAnimationFrame(glide);
  }

  function jump(to: { zoom: number; tx: number; ty: number }) {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    goal = to;
    zoom = to.zoom;
    tx = to.tx;
    ty = to.ty;
  }

  function at(e: PointerEvent) {
    if (!surface) return { x: 0, y: 0 };
    const box = surface.getBoundingClientRect();
    return {
      x: (e.clientX - box.left - bw / 2 - tx) / zoom,
      y: (e.clientY - box.top - bh / 2 - ty) / zoom,
    };
  }

  /* Marks the node only. The canvas takes the pointer capture, so it owns
     every move and release, and a press that never travels stays a click. */
  function grab(e: PointerEvent, key: string) {
    const n = byKey.get(key);
    if (!n) return;
    /* A press must not focus the node: focus is for the keyboard, and a
       dialog closing hands it back to whatever held it, drawing a ring. */
    e.preventDefault();
    dragged = n;
    const p = at(e);
    n.fx = p.x;
    n.fy = p.y;
    from = { x: e.clientX, y: e.clientY };
    moved = false;
  }

  /* The settled layout leaves alpha near zero, and the timer stops below
     ALPHA_MIN, so a drag has to start above it or the timer dies after one
     tick and the node does not follow. */
  function warm() {
    sim
      ?.alphaTarget(DRAG_HEAT)
      .alpha(Math.max(sim.alpha(), ALPHA_MIN * 3))
      .restart();
  }

  /* Scaled by the wheel's own delta, so a trackpad's many small events and a
     mouse's few large ones zoom by the same amount per gesture, and anchored
     on the pointer so the point under it stays under it. */
  function wheel(e: WheelEvent) {
    e.preventDefault();
    if (!surface) return;
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const next = Math.min(
      3,
      Math.max(0.25, goal.zoom * Math.exp(-px * 0.0015)),
    );
    const box = surface.getBoundingClientRect();
    const sx = e.clientX - box.left - bw / 2;
    const sy = e.clientY - box.top - bh / 2;
    const gx = (sx - goal.tx) / goal.zoom;
    const gy = (sy - goal.ty) / goal.zoom;
    steer({ zoom: next, tx: sx - gx * next, ty: sy - gy * next });
  }

  function panDown(e: PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (dragged) return;
    panning = true;
    from = { x: e.clientX, y: e.clientY };
    moved = false;
  }

  function panMove(e: PointerEvent) {
    const travelled = Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP;
    if (dragged) {
      if (travelled && !moved) {
        hold(dragged);
        warm();
      }
      if (travelled) moved = true;
      const p = at(e);
      dragged.fx = p.x;
      dragged.fy = p.y;
      return;
    }
    if (travelled) moved = true;
    if (!panning) return;
    goal = { ...goal, tx: goal.tx + e.movementX, ty: goal.ty + e.movementY };
    tx += e.movementX;
    ty += e.movementY;
  }

  function panUp() {
    panning = false;
    if (!dragged) return;
    const hit = dragged;
    if (moved) drop(hit);
    dragged.fx = null;
    dragged.fy = null;
    dragged = null;
    hold(null);
    if (!moved) {
      if (hit.kind === "component") pickNode(hit.key);
      return;
    }
    /* Full heat only keeps the timer alive: the springs do not scale with it,
       and the tick handler stops the timer once everything is at its home. */
    sim?.alphaTarget(0).alpha(1).restart();
  }

  /** Frames the settled graph, labels included, in the measured box. */
  function fit(dots: Dot[], smooth = false) {
    if (!dots.length || !bw || !bh) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const d of dots) {
      const b = boxOf(
        {
          key: d.key,
          kind: d.kind,
          label: d.label,
          weight: 0,
          depth: d.depth,
          side: d.side,
        },
        0,
      );
      minX = Math.min(minX, d.x - b.left);
      maxX = Math.max(maxX, d.x + b.right);
      minY = Math.min(minY, d.y - b.up);
      maxY = Math.max(maxY, d.y + b.down);
    }
    const margin = 32;
    const w = Math.max(1, maxX - minX + margin * 2);
    const h = Math.max(1, maxY - minY + margin * 2);
    /* A local, not zoom: reading zoom back here would make the effect that
       calls fit depend on it, and every wheel turn would re-run the layout. */
    const scale = Math.min(1.4, Math.max(0.3, Math.min(bw / w, bh / h)));
    const to = {
      zoom: scale,
      tx: -((minX + maxX) / 2) * scale,
      ty: -((minY + maxY) / 2) * scale,
    };
    if (smooth) steer(to);
    else jump(to);
  }

  function reset() {
    if (!sim) return;
    refit = true;
    sim.alphaTarget(0).alpha(0.6).restart();
  }

  const pickNode = (key: string) => {
    const n = graph.nodes.find((g) => g.key === key);
    if (n) onpick(n);
  };
</script>

{#if !graph.nodes.length}
  <EmptyState
    title="Nothing matches."
    detail="Clear the filters to see the whole catalogue."
  />
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="map"
    class:panning
    role="application"
    aria-label="component architecture: drag a node or the canvas, scroll to zoom, double-click to settle"
    bind:this={surface}
    onwheel={wheel}
    onpointerdown={panDown}
    onpointermove={panMove}
    onpointerup={panUp}
    onpointercancel={panUp}
    ondblclick={reset}
    use:measureBox={(w, h) => {
      bw = w;
      bh = h;
    }}
  >
    <svg viewBox="{-bw / 2} {-bh / 2} {bw} {bh}" role="presentation">
      <!-- Declared inside the svg so its elements get the SVG namespace. -->
      {#snippet body(n: Dot)}
        <title>{n.kind}: {n.label}</title>
        <circle class="hit" r={n.r + 8} />
        <circle class="dot" r={n.r} />
        <text
          x={n.side * (n.r + LABEL_GAP)}
          text-anchor={n.side < 0 ? "end" : "start"}
          dominant-baseline="middle"
          style="font-size: {n.fs}px">{n.label}</text
        >
      {/snippet}
      <g transform="translate({tx}, {ty}) scale({zoom})">
        {#each edges as e (e.key)}
          <line class="link" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
        {/each}

        {#each placed as n (n.key)}
          <g class="node {n.kind}" class:top={n.depth === 1} transform="translate({n.x}, {n.y})">
            {#if n.kind === "component"}
              <g
                role="button"
                tabindex="0"
                aria-label="edit {n.label}"
                onpointerdown={(e) => grab(e, n.key)}
                onkeydown={(e) => e.key === "Enter" && pickNode(n.key)}
              >
                {@render body(n)}
              </g>
            {:else}
              <g role="presentation" onpointerdown={(e) => grab(e, n.key)}>
                {@render body(n)}
              </g>
            {/if}
          </g>
        {/each}
      </g>
    </svg>
  </div>
{/if}

<style>
  .map {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
    background: color-mix(in srgb, var(--panel-solid) 60%, transparent);
    cursor: grab;
    touch-action: none;
  }
  .map.panning {
    cursor: grabbing;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .link {
    stroke: color-mix(in srgb, var(--muted) 45%, transparent);
    stroke-width: 1;
  }

  .hit {
    fill: transparent;
  }
  .dot {
    fill: var(--panel-solid);
    stroke: var(--muted);
    stroke-width: 1.5;
  }
  .node text {
    fill: var(--muted);
    font-family: var(--font-ui);
    pointer-events: none;
    user-select: none;
  }

  .node.product .dot {
    fill: var(--text);
    stroke: var(--text);
  }
  .node.product text {
    fill: var(--text);
    font-weight: 600;
  }
  .node.top .dot {
    stroke: var(--text);
    stroke-width: 1.75;
  }
  .node.top text {
    fill: var(--text);
  }
  .node > g {
    cursor: grab;
  }
  .node.component > g {
    cursor: pointer;
  }
  .node.component > g:hover .dot,
  .node.component > g:focus-visible .dot {
    stroke: var(--text);
    stroke-width: 2.5;
  }
  .node.component > g:hover text,
  .node.component > g:focus-visible text {
    fill: var(--text);
  }
  .node > g:focus {
    outline: none;
  }
</style>
