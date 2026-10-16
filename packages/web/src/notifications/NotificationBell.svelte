<script lang="ts">
  import type { NotificationRow } from "@tachy/contract";
  import { navigate, router } from "../shell/router.svelte";
  import { Button, Time } from "../tui";
  import { boardItemPath } from "../work-items/board";
  import { itemChanges, markNotificationsRead } from "./notify.svelte";

  let shown = $state(false);
  let hostEl = $state<HTMLElement>();

  const changes = $derived(itemChanges());
  const unreadIds = $derived(
    changes.filter((change) => !change.read_at).map((change) => change.id),
  );

  $effect(() => {
    void router.path;
    shown = false;
  });

  /** A change note carries where its item lives on the board. */
  function itemPath(change: NotificationRow): string | null {
    const { source_project_id: projectId, external_id: itemId } =
      change.ref as Record<string, unknown>;
    return typeof projectId === "string" && typeof itemId === "string"
      ? boardItemPath(projectId, itemId)
      : null;
  }

  function open(change: NotificationRow) {
    void markNotificationsRead([change.id]);
    const path = itemPath(change);
    if (path) navigate(path);
  }

  function outside(e: PointerEvent) {
    if (shown && !hostEl?.contains(e.target as Node)) shown = false;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    shown = false;
  }
</script>

<svelte:window onpointerdown={outside} />

{#if unreadIds.length || shown}
  <div class="host" bind:this={hostEl}>
    <Button
      variant="ghost"
      size="sm"
      square
      icon={unreadIds.length ? "changesUnread" : "changes"}
      tone={unreadIds.length ? "accent" : undefined}
      aria-label={unreadIds.length
        ? `${unreadIds.length} changes on items you follow`
        : "Changes on items you follow"}
      title="changes on items you follow"
      onclick={() => (shown = !shown)}
    />
    {#if shown}
      <div
        class="menu"
        role="dialog"
        aria-label="Changes on items you follow"
        tabindex="-1"
        {onkeydown}
      >
        {#each changes as change (change.id)}
          <button
            class="change"
            class:unread={!change.read_at}
            onclick={() => open(change)}
          >
            <span class="head">
              <span class="title">{change.title}</span>
              <span class="at"><Time at={change.created_at} /></span>
            </span>
            {#if change.body_text}<span class="lines">{change.body_text}</span
              >{/if}
          </button>
        {:else}
          <p class="note">
            Nothing new. Changes others make to items you follow show here.
          </p>
        {/each}
        {#if unreadIds.length}
          <div class="foot">
            <Button
              size="sm"
              variant="ghost"
              onclick={() => markNotificationsRead(unreadIds)}
              >mark all read</Button
            >
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .host {
    position: relative;
  }
  .menu {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    z-index: 8;
    width: min(26rem, 80vw);
    max-height: 24rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 0.25rem;
    background: var(--panel-solid);
    border: 1px solid var(--accent);
    border-radius: 6px;
  }
  .change {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.45rem 0.55rem;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--muted);
    font: inherit;
    font-size: 0.8rem;
    text-align: left;
    cursor: pointer;
  }
  .change.unread {
    color: var(--text);
  }
  .change:hover,
  .change:focus-visible {
    outline: none;
    background: var(--accent-dim);
  }
  .head {
    display: flex;
    gap: var(--pad-2);
    align-items: baseline;
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .unread .title {
    font-weight: 600;
  }
  .at {
    flex: none;
    font-size: 0.7rem;
    color: var(--muted);
  }
  .lines {
    white-space: pre-line;
    color: var(--muted);
  }
  .note {
    margin: 0;
    padding: 0.45rem 0.55rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
  }
</style>
