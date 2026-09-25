<script lang="ts">
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import { createSequence } from "../resource.svelte";
  import { Badge, Modal } from "../tui";
  import type { WikiSearchHit } from "../types";
  import { wikiPath } from "./paths";

  /** The wiki's own quick-find (ctrl+k): this wiki's articles, drafts included. */
  let { scope, onClose }: { scope: string; onClose: () => void } = $props();

  let q = $state("");
  let hits = $state<WikiSearchHit[]>([]);
  let cursor = $state(0);
  let inputEl = $state<HTMLInputElement>();

  const current = createSequence();

  $effect(() => {
    inputEl?.focus();
  });

  /* Debounced, and sequenced so a slower response cannot land on top of the
     query typed after it. */
  $effect(() => {
    const term = q.trim();
    const isCurrent = current();
    if (!term) {
      hits = [];
      cursor = 0;
      return;
    }
    const t = setTimeout(async () => {
      try {
        const rows = await api.get<WikiSearchHit[]>(
          `/library/wiki/${scope}/search?q=${encodeURIComponent(term)}`,
        );
        if (!isCurrent()) return;
        hits = rows;
        cursor = 0;
      } catch {
        if (isCurrent()) hits = [];
      }
    }, 200);
    return () => clearTimeout(t);
  });

  function open(hit: WikiSearchHit) {
    if (!hit.slug) return;
    navigate(wikiPath(scope, hit.slug));
    onClose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      cursor = Math.min(cursor + 1, hits.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[cursor]) open(hits[cursor]);
    }
  }
</script>

<Modal title="search this wiki" width="42rem" onCancel={onClose}>
  <div class="search">
    <input
      bind:this={inputEl}
      bind:value={q}
      class="q"
      placeholder="find an article…"
      aria-label="search this wiki"
      onkeydown={onKeydown}
    />
    {#if q.trim() && hits.length === 0}
      <p class="empty">Nothing here matches.</p>
    {/if}
    {#if hits.length}
      <ul>
        {#each hits as h, i (h.id)}
          <li>
            <button class="hit" class:on={i === cursor} onclick={() => open(h)}>
              <span class="head">
                <span class="title">{h.title}</span>
                {#if h.status === "draft"}<Badge tone="accent">draft</Badge>{/if}
              </span>
              {#if h.snippet}<span class="snip">{h.snippet}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</Modal>

<style>
  .search {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .q {
    width: 100%;
  }
  .empty {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 24rem;
    overflow-y: auto;
    scrollbar-width: thin;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .hit {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    padding: var(--pad-2);
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .hit:hover,
  .hit.on {
    background: var(--panel);
    border-left-color: var(--accent);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
  }
  .title {
    font-weight: 600;
  }
  .snip {
    font-size: var(--fs-xs);
    color: var(--muted);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
</style>
