<script module lang="ts">
  import type { BuiltinCommandMeta, CommandArtifactMeta } from "../agent";

  export type CommandMode = "command" | "artifact";

  export type CommandPick =
    | { kind: "builtin"; builtin: BuiltinCommandMeta }
    | { kind: "artifact"; artifact: CommandArtifactMeta };

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
    const q = query.trim().toLowerCase();
    return artifacts.filter(
      (a) => !q || `${a.slug} ${a.title}`.toLowerCase().includes(q),
    );
  }
</script>

<script lang="ts">
  let {
    mode = "command",
    query,
    builtins,
    artifacts,
    onpick,
  }: {
    mode?: CommandMode;
    query: string;
    builtins: BuiltinCommandMeta[];
    artifacts: CommandArtifactMeta[];
    onpick: (pick: CommandPick) => void;
  } = $props();

  const items = $derived(
    mode === "artifact"
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

  let idx = $state(0);
  $effect(() => {
    void query;
    void mode;
    idx = 0;
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

{#if items.length || mode === "artifact"}
  <div class="cmd-menu" role="listbox" aria-label="Commands">
    {#if mode === "artifact"}
      <div class="cmd-crumb">
        <span class="cmd-cmd">/{ARTIFACT_COMMAND.name}</span>
        <span class="cmd-param">artifact</span>
        <span class="cmd-desc">{ARTIFACT_COMMAND.description}</span>
      </div>
    {/if}
    {#each items as item, i (item.key)}
      <button
        class="cmd-row"
        class:active={i === idx}
        role="option"
        aria-selected={i === idx}
        onmouseenter={() => (idx = i)}
        onclick={() => onpick(item.pick)}
      >
        <span class="cmd-label">{item.label}</span>
        {#if item.hint}<span class="cmd-hint">{item.hint}</span>{/if}
        {#if item.desc}<span class="cmd-desc">{item.desc}</span>{/if}
      </button>
    {/each}
    {#if !items.length}
      <div class="cmd-none">no artifact matches</div>
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
    overflow-y: auto;
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
    background: var(--accent);
    border-radius: 3px;
    padding: 0.05rem 0.35rem;
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
