<script module lang="ts">
  import type { BuiltinCommandMeta, CommandArtifactMeta } from "../agent";

  export type CommandPick =
    | { kind: "builtin"; builtin: BuiltinCommandMeta }
    | { kind: "artifact"; artifact: CommandArtifactMeta };
</script>

<script lang="ts">
  let {
    query,
    builtins,
    artifacts,
    onpick,
  }: {
    query: string;
    builtins: BuiltinCommandMeta[];
    artifacts: CommandArtifactMeta[];
    onpick: (pick: CommandPick) => void;
  } = $props();

  const q = $derived(query.toLowerCase());
  const items = $derived([
    ...builtins
      .filter((b) => b.name.startsWith(q))
      .map((b) => ({
        key: `b:${b.name}`,
        label: `/${b.name}`,
        hint: b.args,
        desc: b.description,
        pick: { kind: "builtin", builtin: b } as CommandPick,
      })),
    ...artifacts
      .filter((a) => `${a.slug} ${a.title}`.toLowerCase().includes(q))
      .map((a) => ({
        key: `a:${a.id}`,
        label: `◈ ${a.title}`,
        hint: "artifact",
        desc: a.description ?? "",
        pick: { kind: "artifact", artifact: a } as CommandPick,
      })),
  ]);

  let idx = $state(0);
  $effect(() => {
    void q;
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

{#if items.length}
  <div class="cmd-menu" role="listbox" aria-label="Commands">
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
