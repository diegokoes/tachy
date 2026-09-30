<script lang="ts">
  import type { FlowActionInfo } from "@tachy/contract";
  import { Badge, float, Icon, type IconName } from "../tui";
  import type { Pick } from "./graph";

  let {
    anchor,
    actions,
    onpick,
    onclose,
  }: {
    anchor: HTMLElement;
    actions: FlowActionInfo[];
    onpick: (p: Pick) => void;
    onclose: () => void;
  } = $props();

  let query = $state("");
  let panel = $state<HTMLElement>();
  let input = $state<HTMLInputElement>();
  $effect(() => input?.focus());

  const GROUPS: { key: string; label: string; icon: IconName }[] = [
    { key: "control", label: "control", icon: "flowIf" },
    { key: "context", label: "gather context", icon: "search" },
    { key: "agent", label: "ask tachy", icon: "ai" },
    { key: "write", label: "act", icon: "edit" },
  ];
  const SOURCE_NAMES: Record<string, string> = {
    "azure-devops": "ADO",
    freshdesk: "Freshdesk",
    github: "GitHub",
  };

  type Entry = {
    group: string;
    title: string;
    description: string | null;
    source: string | null;
    pick: Pick;
  };
  const entries = $derived<Entry[]>([
    {
      group: "control",
      title: "if",
      description: "Two branches: one when the condition holds, one when not.",
      source: null,
      pick: { kind: "if" },
    },
    {
      group: "control",
      title: "only if",
      description: "Stops the run here unless the condition holds.",
      source: null,
      pick: { kind: "filter" },
    },
    ...actions.map((a) => ({
      group: a.category,
      title: a.title,
      description: a.description,
      source: a.source,
      pick: { kind: "action" as const, action: a },
    })),
  ]);
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        !q ||
        `${e.title} ${e.description ?? ""} ${e.source ?? ""}`
          .toLowerCase()
          .includes(q),
    );
  });

  function outside(e: PointerEvent) {
    const t = e.target as Node;
    if (!panel?.contains(t) && !anchor.contains(t)) onclose();
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
    if (e.key === "Enter" && shown[0]) onpick(shown[0].pick);
  }
</script>

<svelte:window onpointerdown={outside} />

<div
  class="palette"
  role="dialog"
  aria-label="Add a step"
  bind:this={panel}
  use:float={{ anchor, placement: "beside", gap: 8 }}
>
  <input
    bind:this={input}
    bind:value={query}
    class="q"
    placeholder="search the library…"
    aria-label="Search the library"
    autocomplete="off"
    {onkeydown}
  />
  <div class="list">
    {#each GROUPS as g (g.key)}
      {@const items = shown.filter((e) => e.group === g.key)}
      {#if items.length}
        <div class="group">
          <span class="head"><Icon name={g.icon} size="0.9em" /> {g.label}</span
          >
          {#each items as e (e.title)}
            <button class="entry" onclick={() => onpick(e.pick)}>
              <span class="title">
                {e.title}
                {#if e.source}<Badge tone="muted"
                    >{SOURCE_NAMES[e.source] ?? e.source}</Badge
                  >{/if}
              </span>
              {#if e.description}<span class="desc">{e.description}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="none">nothing matches</p>
    {/each}
  </div>
</div>

<style>
  .palette {
    z-index: calc(var(--z-overlay) + 1);
    display: flex;
    flex-direction: column;
    width: 20rem;
    max-height: 26rem;
    padding: 2px;
    background: var(--panel-bg);
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    border-radius: var(--radius-control);
    box-shadow: 0 4px 14px var(--drop);
  }
  .q {
    flex: none;
    margin-bottom: 2px;
  }
  .list {
    overflow-y: auto;
    padding: var(--pad-1);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: var(--pad-2);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--pad-1);
    padding: var(--pad-1) var(--pad-2);
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--pad-2);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .entry:hover,
  .entry:focus-visible {
    background: var(--accent-dim);
  }
  .title {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-sm);
  }
  .desc {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .none {
    margin: var(--pad-2);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
</style>
