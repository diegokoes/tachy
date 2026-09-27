<script lang="ts">
  import { G, Modal } from "../tui";
  import type { IssueGroup } from "./issueMessages";

  let {
    page,
    groups,
    loading = false,
    error = null,
    onpick,
    onclose,
  }: {
    page: string;
    groups: IssueGroup[];
    loading?: boolean;
    error?: string | null;
    /** Go to the section that fixes it. */
    onpick: (section: string) => void;
    onclose: () => void;
  } = $props();
</script>

<Modal title="issues · {page}" cancelLabel="close" width="36rem" onCancel={onclose}>
  {#if error}
    <p class="quiet danger">{error}</p>
  {:else if !groups.length}
    <p class="quiet">{loading ? "checking…" : "nothing to fix"}</p>
  {:else}
    <ul class="groups">
      {#each groups as g (g.key)}
        <li class="group {g.tone}">
          <button class="head" title="go to {g.section}" onclick={() => onpick(g.section)}>
            <span class="mark" aria-hidden="true"></span>
            <span class="text">{g.head}</span>
            <span class="go" aria-hidden="true">{g.section} {G.right}</span>
          </button>
          {#if g.items.length}
            <ul class="items">
              {#each g.items as it (it.key)}
                <li>
                  <button class="item" onclick={() => onpick(g.section)}>{it.text}</button>
                </li>
              {/each}
              {#if g.more}
                <li>
                  <button class="item more" onclick={() => onpick(g.section)}>+{g.more} more</button>
                </li>
              {/if}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  /* Capped so the dialog, centred, never reaches the window's carved top
     edge: the carve is a mask on the window, and it cuts a dialog opened from
     inside it just as it cuts the page. A long list scrolls here instead. */
  .groups {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    max-height: calc(100dvh - 24rem);
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }

  button {
    width: 100%;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    background: color-mix(in srgb, var(--muted) 12%, transparent);
  }

  .head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-1) var(--pad-2);
    font-size: var(--fs-sm);
  }
  .mark {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 1px;
    background: var(--tone-color);
  }
  .go {
    font-size: var(--fs-xs);
    color: var(--muted);
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .head:hover .go,
  .head:focus-visible .go {
    opacity: 1;
  }

  .items {
    list-style: none;
    margin: 0 0 0 calc(var(--pad-2) + 0.25rem);
    padding: 0 0 0 var(--pad-3);
    display: flex;
    flex-direction: column;
    border-left: 1px solid color-mix(in srgb, var(--tone-color) 45%, transparent);
  }
  .item {
    padding: var(--pad-1) var(--pad-2);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .item.more {
    color: var(--muted);
  }

  .quiet {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .quiet.danger {
    color: var(--danger);
  }

  .warn {
    --tone-color: var(--warn);
  }
  .danger {
    --tone-color: var(--danger);
  }
</style>
