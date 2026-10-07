<script module lang="ts">
  import type { BuiltinCommandMeta, CommandArtifactMeta } from "./agent";
  import type { IconName } from "../tui/icons";

  export type CommandMode = "command" | "artifact" | "options";

  /** One row of an argument the caller completes itself, e.g. `/az new <project>`. */
  export interface MenuOption {
    value: string;
    label: string;
    hint?: string;
    desc?: string;
    icon?: IconName;
    /** A small swatch beside the icon, e.g. a work item type's own colour. */
    color?: string | null;
  }

  /** What an options menu is completing, drawn above the rows. */
  export interface MenuCrumb {
    cmd: string;
    param: string;
    desc?: string;
    /** Said instead of rows when there are none: loading, or why not. */
    empty?: string;
    /** Rows are short names: lay them out in columns, read top to bottom. */
    grid?: boolean;
  }

  export type CommandPick =
    | { kind: "builtin"; builtin: BuiltinCommandMeta }
    | { kind: "artifact"; artifact: CommandArtifactMeta }
    | { kind: "option"; value: string };

  /** Client-side command: it attaches an artifact instead of prompting the agent. */
  export const ARTIFACT_COMMAND: BuiltinCommandMeta = {
    name: "artifact",
    args: "<artifact>",
    description: "Attach an artifact to the next message",
  };

  export function matchArtifacts(
    artifacts: CommandArtifactMeta[],
    query: string,
  ): CommandArtifactMeta[] {
    const needle = query.trim().toLowerCase();
    return artifacts.filter(
      (a) => !needle || `${a.slug} ${a.title}`.toLowerCase().includes(needle),
    );
  }
</script>

<script lang="ts">
  import { Icon } from "../tui";

  let {
    mode = "command",
    query,
    builtins,
    artifacts,
    options = [],
    crumb,
    onpick,
  }: {
    mode?: CommandMode;
    query: string;
    builtins: BuiltinCommandMeta[];
    artifacts: CommandArtifactMeta[];
    options?: MenuOption[];
    crumb?: MenuCrumb;
    onpick: (pick: CommandPick) => void;
  } = $props();

  type Item = {
    key: string;
    label: string;
    hint?: string;
    desc: string;
    icon?: IconName;
    color?: string | null;
    pick: CommandPick;
  };

  const items = $derived<Item[]>(
    mode === "options"
      ? options.map((o) => ({
          key: `o:${o.value}`,
          label: o.label,
          hint: o.hint,
          desc: o.desc ?? "",
          icon: o.icon,
          color: o.color,
          pick: { kind: "option", value: o.value } as CommandPick,
        }))
      : mode === "artifact"
        ? matchArtifacts(artifacts, query).map((a) => ({
            key: `a:${a.id}`,
            label: `⛬ ${a.title}`,
            hint: a.slug,
            desc: a.description ?? "",
            pick: { kind: "artifact", artifact: a } as CommandPick,
          }))
        : [...builtins, ARTIFACT_COMMAND]
            .filter((b) => b.name.startsWith(query.toLowerCase()))
            .map((b) => ({
              key: `b:${b.name}`,
              label: `/${b.name}`,
              hint: b.args,
              desc: b.description,
              pick: { kind: "builtin", builtin: b } as CommandPick,
            })),
  );

  const GRID_COLUMNS = 3;
  const grid = $derived(mode === "options" && !!crumb?.grid);
  const gridRows = $derived(Math.ceil(items.length / GRID_COLUMNS));

  let idx = $state(0);
  let rows = $state<HTMLElement>();
  $effect(() => {
    void query;
    void mode;
    idx = 0;
  });
  $effect(() => {
    rows?.children[idx]?.scrollIntoView({ block: "nearest" });
  });

  export function empty(): boolean {
    return items.length === 0;
  }

  export function move(delta: number): void {
    if (items.length) idx = (idx + delta + items.length) % items.length;
  }

  export function pick(): boolean {
    const item = items[idx];
    if (!item) return false;
    onpick(item.pick);
    return true;
  }
</script>

{#if items.length || mode !== "command"}
  <div class="cmd-menu" role="listbox" aria-label="Commands">
    {#if mode === "artifact"}
      <div class="cmd-crumb">
        <span class="cmd-cmd">/{ARTIFACT_COMMAND.name}</span>
        <span class="cmd-param">artifact</span>
        <span class="cmd-desc">{ARTIFACT_COMMAND.description}</span>
      </div>
    {:else if mode === "options" && crumb}
      <div class="cmd-crumb">
        <span class="cmd-cmd">{crumb.cmd}</span>
        <span class="cmd-param">{crumb.param}</span>
        {#if crumb.desc}<span class="cmd-desc">{crumb.desc}</span>{/if}
      </div>
    {/if}
    <div
      class="cmd-rows"
      class:grid
      style:--rows={grid ? gridRows : undefined}
      bind:this={rows}
    >
      {#each items as item, i (item.key)}
        <button
          class="cmd-row"
          class:active={i === idx}
          role="option"
          aria-selected={i === idx}
          onmouseenter={() => (idx = i)}
          onclick={() => onpick(item.pick)}
        >
          {#if item.icon}
            <span class="cmd-icon" style:color={item.color ?? undefined}>
              <Icon name={item.icon} size="1em" />
            </span>
          {/if}
          <span class="cmd-label">{item.label}</span>
          {#if item.hint}<span class="cmd-hint">{item.hint}</span>{/if}
          {#if item.desc}<span class="cmd-desc">{item.desc}</span>{/if}
        </button>
      {/each}
    </div>
    {#if !items.length}
      <div class="cmd-none">
        {mode === "options"
          ? (crumb?.empty ?? "nothing matches")
          : "no artifact matches"}
      </div>
    {/if}
  </div>
{/if}

<style>
  .cmd-menu {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    z-index: 8;
    margin-bottom: 0.35rem;
    max-height: 14rem;
    display: flex;
    flex-direction: column;
    background: var(--panel-solid);
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 0.25rem;
  }
  .cmd-crumb {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.3rem 0.55rem 0.4rem;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0.25rem;
    flex: none;
  }
  .cmd-cmd {
    flex: none;
    font-size: 0.85rem;
    color: var(--accent);
  }
  .cmd-param {
    flex: none;
    font-size: 0.75rem;
    color: var(--bg);
    background: var(--accent-fill);
    border-radius: 3px;
    padding: 0.05rem 0.35rem;
  }
  .cmd-rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .cmd-rows.grid {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(var(--rows), auto);
    grid-auto-columns: minmax(0, 1fr);
  }
  .grid .cmd-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmd-none {
    padding: 0.35rem 0.55rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .cmd-row {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 0.35rem 0.55rem;
    cursor: pointer;
  }
  .cmd-row.active {
    background: var(--accent-dim);
  }
  .cmd-icon {
    flex: none;
    align-self: center;
    display: inline-flex;
    color: var(--muted);
  }
  .cmd-label {
    flex: none;
    font-size: 0.85rem;
    color: var(--accent);
  }
  .cmd-hint {
    flex: none;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .cmd-desc {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
