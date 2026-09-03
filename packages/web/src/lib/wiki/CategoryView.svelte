<script lang="ts">
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import type { WikiToc, WikiTocNode, WikiArticleRef } from "../types";

  let { scope, slug }: { scope: string; slug: string } = $props();

  let toc = $state<WikiToc | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    void scope;
    void slug;
    load();
  });

  async function load() {
    error = null;
    try {
      toc = await api.get<WikiToc>(`/library/wiki/${scope}/toc`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  /** The ToC is already the whole tree, so the category page is a walk of it. */
  function find(nodes: WikiTocNode[]): WikiTocNode | null {
    for (const n of nodes) {
      if (n.slug === slug) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  }

  const node = $derived(toc ? find(toc.categories) : null);

  const open = (a: WikiArticleRef) =>
    navigate(`/library/wiki/${scope}/${a.slug}`);
</script>

<div class="cat">
  <nav class="crumb">
    <a href="/library/wiki/{scope}" onclick={(e) => { e.preventDefault(); navigate(`/library/wiki/${scope}`); }}>
      {scope} wiki
    </a>
    <span class="sep">/</span>
    <a href="/library/wiki/{scope}/toc" onclick={(e) => { e.preventDefault(); navigate(`/library/wiki/${scope}/toc`); }}>
      contents
    </a>
  </nav>

  {#if error}
    <p class="err">{error}</p>
  {:else if node}
    <h2>{node.name}</h2>
    {#if node.description}<p class="desc">{node.description}</p>{/if}

    {#if node.children.length}
      <section>
        <h3>Subcategories</h3>
        <ul>
          {#each node.children as child (child.id)}
            <li>
              <button onclick={() => navigate(`/library/wiki/${scope}/c/${child.slug}`)}>
                {child.name}
              </button>
              <span class="count">{child.articles.length}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <h3>Articles</h3>
      {#if node.articles.length}
        <ul>
          {#each node.articles as a (a.id)}
            <li><button onclick={() => open(a)}>{a.title}</button></li>
          {/each}
        </ul>
      {:else}
        <p class="muted">Nothing filed here yet.</p>
      {/if}
    </section>
  {:else if toc}
    <p class="muted">No category '{slug}' in this wiki.</p>
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</div>

<style>
  .cat {
    max-width: 70ch;
    margin: 0 auto;
  }
  .crumb {
    font-size: 0.85em;
    opacity: 0.7;
    margin-bottom: var(--pad-2);
  }
  .crumb a {
    color: inherit;
  }
  .crumb .sep {
    margin: 0 0.4rem;
    opacity: 0.5;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-2);
  }
  h3 {
    font-size: 0.95em;
    margin: var(--pad-3) 0 0.3rem;
  }
  .desc {
    opacity: 0.8;
    margin: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    padding: 0.15rem 0;
  }
  button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  button:hover {
    text-decoration: underline;
  }
  .count {
    opacity: 0.5;
    font-size: 0.85em;
    margin-left: 0.5rem;
  }
  .muted {
    opacity: 0.6;
  }
  .err {
    color: var(--bad, crimson);
  }
</style>
