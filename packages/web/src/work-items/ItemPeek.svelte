<script lang="ts">
  import { Icon } from "../tui";
  import { typeColor, typeIcon } from "./ado-icons";
  import type { PeekState } from "./peek.svelte";

  let {
    state,
    idle,
    sourceLabel,
  }: {
    state: PeekState;
    idle: string;
    /** Names where the item was looked for: "Azure DevOps projects". */
    sourceLabel: string;
  } = $props();
</script>

<div class="peek" aria-live="polite">
  {#if state.status === "idle"}
    <span class="note">{idle}</span>
  {:else if state.status === "looking"}
    <span class="note">looking up #{state.id}…</span>
  {:else if state.status === "failed"}
    <span class="note">{state.message}</span>
  {:else if !state.peeks.length}
    <span class="note">no item #{state.id} in your {sourceLabel}</span>
  {:else}
    {#each state.peeks as item (`${item.source_slug}:${item.id}`)}
      <div class="hit">
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          <span class="id">#{item.id}</span>
          <span class="title">{item.title}</span>
        </a>
        {#if item.icon}
          <span class="glyph" style:color={typeColor(item.color) ?? undefined}>
            <Icon name={typeIcon(item.icon)} size="1em" />
          </span>
        {/if}
        <span class="meta">
          {[item.type, item.state, item.project].filter(Boolean).join(" · ")}
        </span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .peek {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.35rem 0.55rem;
    font-size: 0.8rem;
  }
  .note {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .hit {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  a {
    display: flex;
    gap: 0.5rem;
    min-width: 0;
    color: var(--text);
    text-decoration: none;
  }
  a:hover .title,
  a:focus-visible .title {
    text-decoration: underline;
  }
  .id {
    flex: none;
    color: var(--accent);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .glyph {
    flex: none;
    display: inline-flex;
    color: var(--muted);
  }
  .meta {
    flex: none;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
