<script lang="ts">
  import {
    FLOW_ACTION_CATEGORIES,
    type FlowActionCategory,
    type FlowActionInfo,
  } from "@tachy/contract";
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
  let sub = $state<HTMLElement>();
  let input = $state<HTMLInputElement>();
  $effect(() => input?.focus());

  const GROUPS: Record<FlowActionCategory, { label: string; icon: IconName }> =
    {
      control: { label: "logic", icon: "flowIf" },
      read: { label: "read", icon: "flowRead" },
      search: { label: "search", icon: "flowSearch" },
      agent: { label: "ask tachy", icon: "flowAgent" },
      update: { label: "update", icon: "flowUpdate" },
      create: { label: "create", icon: "flowCreate" },
    };
  const SOURCE_NAMES: Record<string, string> = {
    "azure-devops": "ADO",
    freshdesk: "Freshdesk",
    github: "GitHub",
  };

  type Entry = {
    group: FlowActionCategory;
    title: string;
    description: string | null;
    source: string | null;
    pick: Pick;
  };
  const entries = $derived<Entry[]>([
    {
      group: "control",
      title: "if / else",
      description:
        "Two branches: one when the condition matches, one when not.",
      source: null,
      pick: { kind: "if" },
    },
    {
      group: "control",
      title: "only if",
      description: "Stops the run here unless the condition matches.",
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
  const groups = $derived(
    FLOW_ACTION_CATEGORIES.map((key) => ({
      key,
      ...GROUPS[key],
      items: entries.filter((e) => e.group === key),
    })).filter((g) => g.items.length),
  );

  const searching = $derived(query.trim() !== "");
  const found = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) =>
      `${e.title} ${e.description ?? ""} ${e.source ?? ""} ${GROUPS[e.group].label}`
        .toLowerCase()
        .includes(q),
    );
  });

  /** The highlighted row of the first panel: a group, or a search hit. */
  let cursor = $state(0);
  let open = $state<FlowActionCategory | null>(null);
  /** The highlighted child; -1 while the keys are still on the groups. */
  let child = $state(-1);
  const rows: HTMLElement[] = $state([]);

  const openGroup = $derived(groups.find((g) => g.key === open) ?? null);
  const openRow = $derived(
    open ? rows[groups.findIndex((g) => g.key === open)] : undefined,
  );

  $effect(() => {
    void query;
    cursor = 0;
    open = null;
    child = -1;
  });

  function show(i: number, focusChild = false) {
    cursor = i;
    open = groups[i]?.key ?? null;
    child = focusChild ? 0 : -1;
  }

  function outside(e: PointerEvent) {
    const t = e.target as Node;
    if (!panel?.contains(t) && !sub?.contains(t) && !anchor.contains(t))
      onclose();
  }

  const step = (at: number, by: number, n: number) => (at + by + n) % n;

  function onkeydown(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape") {
      e.preventDefault();
      if (child >= 0) child = -1;
      else if (open) open = null;
      else onclose();
      return;
    }
    if (searching) {
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        if (found.length)
          cursor = step(cursor, k === "ArrowDown" ? 1 : -1, found.length);
      } else if (k === "Enter" && found[cursor]) onpick(found[cursor].pick);
      return;
    }
    if (child >= 0 && openGroup) {
      const n = openGroup.items.length;
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        child = step(child, k === "ArrowDown" ? 1 : -1, n);
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        child = -1;
      } else if (k === "Enter") onpick(openGroup.items[child].pick);
      return;
    }
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      const i = step(cursor, k === "ArrowDown" ? 1 : -1, groups.length);
      if (open) show(i);
      else cursor = i;
    } else if (k === "ArrowRight" || k === "Enter") {
      e.preventDefault();
      show(cursor, true);
    } else if (k === "ArrowLeft" && open) {
      e.preventDefault();
      open = null;
    }
  }
</script>

<svelte:window onpointerdown={outside} />

{#snippet entry(e: Entry, active: boolean, tag: boolean)}
  <button
    class="entry"
    class:active
    role="menuitem"
    onclick={() => onpick(e.pick)}
  >
    <span class="title">
      {e.title}
      {#if e.source}<Badge tone="muted"
          >{SOURCE_NAMES[e.source] ?? e.source}</Badge
        >{/if}
      {#if tag}<span class="tag">{GROUPS[e.group].label}</span>{/if}
    </span>
    {#if e.description}<span class="desc">{e.description}</span>{/if}
  </button>
{/snippet}

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
    aria-label="Search the steps"
    autocomplete="off"
    {onkeydown}
  />
  {#if searching}
    <div class="list wide" role="menu">
      {#each found as e, i (`${e.group}:${e.title}`)}
        {@render entry(e, i === cursor, true)}
      {:else}
        <p class="none">nothing matches</p>
      {/each}
    </div>
  {:else}
    <div class="list" role="menu">
      {#each groups as g, i (g.key)}
        <button
          bind:this={rows[i]}
          class="group"
          class:active={i === cursor}
          class:open={g.key === open}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={g.key === open}
          onclick={() => {
            if (g.key === open) open = null;
            else show(i);
            input?.focus();
          }}
          onpointerenter={() => open && show(i)}
        >
          <Icon name={g.icon} size="0.95em" />
          <span class="label">{g.label}</span>
          <span class="count">{g.items.length}</span>
          <Icon name="flowGroup" size="0.85em" />
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if openGroup && openRow && !searching}
  <div
    class="palette children"
    role="menu"
    aria-label={openGroup.label}
    bind:this={sub}
    use:float={{ anchor: openRow, placement: "beside", gap: 6 }}
  >
    <div class="list">
      {#each openGroup.items as e, i (e.title)}
        {@render entry(e, i === child, false)}
      {/each}
    </div>
  </div>
{/if}

<style>
  .palette {
    z-index: calc(var(--z-overlay) + 1);
    display: flex;
    flex-direction: column;
    width: 12rem;
    max-height: 26rem;
    padding: 2px;
    background: var(--panel-bg);
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    border-radius: var(--radius-control);
    box-shadow: 0 4px 14px var(--drop);
  }
  .palette:has(.wide),
  .children {
    width: 20rem;
  }
  .q {
    flex: none;
    margin-bottom: 2px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow-y: auto;
    padding: var(--pad-1);
  }
  .group,
  .entry {
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .group {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-2);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .group .label {
    flex: 1;
    color: var(--text);
  }
  .count {
    font-size: var(--fs-xs);
  }
  .group.open {
    color: var(--accent);
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--pad-2);
  }
  .group:hover,
  .group:focus-visible,
  .group.active,
  .group.open,
  .entry:hover,
  .entry:focus-visible,
  .entry.active {
    background: var(--accent-dim);
  }
  .title {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-sm);
  }
  .tag {
    margin-left: auto;
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
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
