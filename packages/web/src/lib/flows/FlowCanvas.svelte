<script lang="ts">
  import type {
    FlowActionCategory,
    FlowActionInfo,
    FlowGraph,
    FlowStep,
    FlowStepStatus,
    FlowTrigger,
  } from "@tachy/contract";
  import { Icon, tip, type IconName } from "../tui";
  import {
    describeCondition,
    describeTrigger,
    TRIGGER_TITLES,
    type Selection,
    type Slot,
  } from "./graph";
  import { layoutFlow, linkPath, SLOT } from "./layout";

  let {
    graph,
    actions,
    selected,
    statuses = null,
    onselect,
    onslot,
    onaddtrigger,
  }: {
    graph: FlowGraph;
    actions: Map<string, FlowActionInfo>;
    selected: Selection | null;
    /** A run's outcome per step, when one is being looked at. */
    statuses?: Map<string, FlowStepStatus | "held" | "not held"> | null;
    onselect: (s: Selection | null) => void;
    onslot: (slot: Slot, anchor: HTMLElement) => void;
    onaddtrigger: (anchor: HTMLElement) => void;
  } = $props();

  const drawn = $derived(layoutFlow(graph));

  let viewport = $state<HTMLElement>();
  let x = $state(24);
  let y = $state(16);
  let k = $state(1);
  let fitted = false;

  function fit() {
    if (!viewport) return;
    const { clientWidth: w, clientHeight: h } = viewport;
    /* Fitting a long flow whole would shrink it past reading; it starts at
       a size that reads and the rest is a pan away. */
    k = Math.max(
      0.75,
      Math.min(1, (w - 48) / drawn.width, (h - 32) / drawn.height),
    );
    x = 24;
    y = Math.max(16, (h - drawn.height * k) / 2);
  }
  $effect(() => {
    drawn;
    if (!fitted && viewport) {
      fit();
      fitted = true;
    }
  });

  function zoom(by: number, cx?: number, cy?: number) {
    if (!viewport) return;
    const r = viewport.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    const next = Math.max(0.35, Math.min(1.8, k * by));
    x = px - ((px - x) * next) / k;
    y = py - ((py - y) * next) / k;
    k = next;
  }

  function onwheel(e: WheelEvent) {
    e.preventDefault();
    const r = viewport!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey)
      zoom(Math.exp(-e.deltaY / 300), e.clientX - r.left, e.clientY - r.top);
    else {
      x -= e.deltaX;
      y -= e.deltaY;
    }
  }

  let drag: { px: number; py: number; x: number; y: number } | null = null;
  function onpointerdown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    drag = { px: e.clientX, py: e.clientY, x, y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    x = drag.x + e.clientX - drag.px;
    y = drag.y + e.clientY - drag.py;
  }
  function onpointerup(e: PointerEvent) {
    const moved =
      drag && Math.hypot(e.clientX - drag.px, e.clientY - drag.py) > 3;
    drag = null;
    if (!moved && !(e.target as HTMLElement).closest("button")) onselect(null);
  }

  const TRIGGER_ICONS: Record<FlowTrigger["kind"], IconName> = {
    "item.synced": "triggerSynced",
    manual: "triggerManual",
    schedule: "triggerSchedule",
  };
  const CATEGORY_ICONS: Record<FlowActionCategory, IconName> = {
    control: "flowIf",
    read: "flowRead",
    search: "flowSearch",
    agent: "flowAgent",
    update: "flowUpdate",
    create: "flowCreate",
  };

  function stepFace(s: FlowStep): {
    icon: IconName;
    title: string;
    line: string;
  } {
    if (s.kind === "if")
      return {
        icon: "flowIf",
        title: s.label || "if / else",
        line: describeCondition(s.when),
      };
    if (s.kind === "filter")
      return {
        icon: "flowFilter",
        title: s.label || "only if",
        line: describeCondition(s.when),
      };
    const a = actions.get(s.action);
    return {
      icon: a ? CATEGORY_ICONS[a.category] : "flowRead",
      title: s.label || a?.title || s.action,
      line: s.id,
    };
  }

  const isSel = (kind: Selection["kind"], id: string) =>
    selected?.kind === kind && selected.id === id;
</script>

<div
  class="viewport"
  bind:this={viewport}
  role="application"
  aria-label="Flow"
  {onwheel}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
>
  <div
    class="world"
    style:transform={`translate(${x}px, ${y}px) scale(${k})`}
    style:width={`${drawn.width}px`}
    style:height={`${drawn.height}px`}
  >
    <svg width={drawn.width} height={drawn.height} aria-hidden="true">
      {#each drawn.links as l (l.key)}
        <path d={linkPath(l.from, l.to)} class:else={l.branch === "else"} />
        {#if l.branch}
          <text x={l.from[0] + 10} y={l.to[1] - 6} class="branch"
            >{l.branch}</text
          >
        {/if}
      {/each}
    </svg>

    {#each drawn.triggers as t (t.trigger.id)}
      <button
        class="card trigger"
        class:sel={isSel("trigger", t.trigger.id)}
        style:left={`${t.x}px`}
        style:top={`${t.y}px`}
        style:width={`${t.w}px`}
        style:height={`${t.h}px`}
        onclick={() => onselect({ kind: "trigger", id: t.trigger.id })}
      >
        <span class="glyph"
          ><Icon name={TRIGGER_ICONS[t.trigger.kind]} size="1em" /></span
        >
        <span class="text">
          <span class="title">{TRIGGER_TITLES[t.trigger.kind]}</span>
          <span class="line">{describeTrigger(t.trigger) || t.trigger.id}</span>
        </span>
      </button>
    {/each}
    <button
      class="slot"
      style:left={`${drawn.addTrigger.x}px`}
      style:top={`${drawn.addTrigger.y}px`}
      style:width={`${SLOT}px`}
      style:height={`${SLOT}px`}
      aria-label="Add a trigger"
      use:tip={"add a trigger"}
      onclick={(e) => onaddtrigger(e.currentTarget)}
      ><Icon name="plus" size="0.85em" /></button
    >

    {#each drawn.nodes as p (p.node.key)}
      {#if p.node.kind === "start"}
        <div
          class="card start"
          style:left={`${p.x}px`}
          style:top={`${p.y}px`}
          style:width={`${p.w}px`}
          style:height={`${p.h}px`}
        >
          <span class="glyph"><Icon name="flows" size="1em" /></span>
          <span class="text">
            <span class="title">start</span>
            <span class="line"
              >{graph.triggers.length
                ? `${graph.triggers.length} trigger${graph.triggers.length === 1 ? "" : "s"}`
                : "no trigger yet"}</span
            >
          </span>
        </div>
      {:else if p.node.kind === "slot"}
        {@const slot = p.node.slot}
        <button
          class="slot"
          style:left={`${p.x}px`}
          style:top={`${p.y}px`}
          style:width={`${p.w}px`}
          style:height={`${p.h}px`}
          aria-label="Add a step here"
          use:tip={"add a step"}
          onclick={(e) => onslot(slot, e.currentTarget)}
          ><Icon name="plus" size="0.85em" /></button
        >
      {:else}
        {@const s = p.node.step}
        {@const face = stepFace(s)}
        {@const st = statuses?.get(s.id)}
        <button
          class="card step {s.kind}"
          class:sel={isSel("step", s.id)}
          class:ok={st === "ok" || st === "held"}
          class:failed={st === "failed"}
          class:dry={st === "dry"}
          class:off={st === "not held"}
          class:unrun={statuses && !st}
          style:left={`${p.x}px`}
          style:top={`${p.y}px`}
          style:width={`${p.w}px`}
          style:height={`${p.h}px`}
          onclick={() => onselect({ kind: "step", id: s.id })}
        >
          <span class="glyph"><Icon name={face.icon} size="1em" /></span>
          <span class="text">
            <span class="title">{face.title}</span>
            <span class="line">{face.line}</span>
          </span>
          {#if s.kind === "action" && actions.get(s.action)?.writes}
            <span class="writes" use:tip={"changes something outside tachy"}
              >w</span
            >
          {/if}
        </button>
      {/if}
    {/each}
  </div>

  <div class="zoom">
    <button aria-label="Zoom in" use:tip={"zoom in"} onclick={() => zoom(1.2)}
      ><Icon name="zoomIn" size="0.9em" /></button
    >
    <button
      aria-label="Zoom out"
      use:tip={"zoom out"}
      onclick={() => zoom(1 / 1.2)}><Icon name="zoomOut" size="0.9em" /></button
    >
    <button aria-label="Fit" use:tip={"fit the flow"} onclick={fit}
      ><Icon name="fit" size="0.9em" /></button
    >
  </div>
</div>

<style>
  .viewport {
    position: relative;
    overflow: hidden;
    min-height: 0;
    height: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background-image: radial-gradient(
      color-mix(in srgb, var(--muted) 22%, transparent) 1px,
      transparent 1px
    );
    background-size: 18px 18px;
    cursor: grab;
    touch-action: none;
  }
  .viewport:active {
    cursor: grabbing;
  }
  .world {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  path {
    fill: none;
    stroke: color-mix(in srgb, var(--muted) 55%, transparent);
    stroke-width: 1.25;
  }
  path.else {
    stroke-dasharray: 3 3;
  }
  .branch {
    fill: var(--muted);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .card {
    position: absolute;
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: 0 var(--pad-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--panel-solid);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .card:hover {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }
  .card.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .card.start {
    cursor: default;
    border-style: dashed;
  }
  .card.trigger .glyph {
    color: var(--accent);
  }
  .card.if,
  .card.filter {
    border-radius: calc(var(--radius-control) * 2.5);
  }
  .card.ok {
    border-color: var(--ok);
  }
  .card.failed {
    border-color: var(--danger);
  }
  .card.dry {
    border-color: var(--warn);
    border-style: dashed;
  }
  .card.off,
  .card.unrun {
    opacity: 0.45;
  }
  .glyph {
    display: inline-flex;
    flex: none;
    color: var(--muted);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }
  .title,
  .line {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .title {
    font-size: var(--fs-sm);
  }
  .line {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .writes {
    margin-left: auto;
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--warn);
  }
  .slot {
    position: absolute;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px dashed var(--border);
    border-radius: 999px;
    background: var(--panel-solid);
    color: var(--muted);
    cursor: pointer;
  }
  .slot:hover,
  .slot:focus-visible {
    color: var(--accent);
    border-color: var(--accent);
  }
  .zoom {
    position: absolute;
    right: var(--pad-2);
    bottom: var(--pad-2);
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--panel-solid);
  }
  .zoom button {
    display: inline-flex;
    padding: 4px;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .zoom button:hover {
    color: var(--accent);
  }
</style>
