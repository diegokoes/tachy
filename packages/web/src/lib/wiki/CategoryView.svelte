<script lang="ts">
  import { createSequence, errText } from "../resource.svelte";
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import { Badge, Note } from "../tui";
  import type { WikiToc, WikiTocNode, WikiArticleRef } from "../types";
  import WikiLayout from "./WikiLayout.svelte";
  import { wikiPath } from "./paths";

  let { scope, slug }: { scope: string; slug: string } = $props();

  let toc = $state<WikiToc | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    void scope;
    void slug;
    load();
  });

  const current = createSequence();

  async function load() {
    const isCurrent = current();
    error = null;
    try {
      const next = await api.get<WikiToc>(`/library/wiki/${scope}/toc`);
      if (!isCurrent()) return;
      toc = next;
    } catch (e) {
      if (!isCurrent()) return;
      error = errText(e);
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

  const go = (e: MouseEvent, path: string) => {
    e.preventDefault();
    navigate(path);
  };

  const open = (a: WikiArticleRef) => a.slug && navigate(wikiPath(scope, a.slug));
</script>

<WikiLayout {scope}>
  <div class="cat">
    <nav class="crumb">
      <a
        href={wikiPath(scope, "contents")}
        onclick={(e) => go(e, wikiPath(scope, "contents"))}>contents</a
      >
      <span class="sep">/</span>
      <span>category</span>
    </nav>

    {#if error}
      <Note tone="danger">{error}</Note>
    {:else if node}
      <h2>{node.name}</h2>
      {#if node.description}<p class="desc">{node.description}</p>{/if}

      {#if node.children.length}
        <section>
          <h3>Subcategories</h3>
          <ul>
            {#each node.children as child (child.id)}
              <li>
                <a
                  href={wikiPath(scope, "c", child.slug)}
                  onclick={(e) => go(e, wikiPath(scope, "c", child.slug))}
                  >{child.name}</a
                >
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
              <li>
                <button onclick={() => open(a)}>{a.title}</button>
                {#if a.status === "draft"}<Badge tone="accent">draft</Badge>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">Nothing filed here yet.</p>
        {/if}
      </section>
    {:else if toc}
      <p class="muted">No category '{slug}' in this wiki.</p>
    {:else}
      <p class="muted">loading…</p>
    {/if}
  </div>
</WikiLayout>

<style>
  .cat {
    max-width: 78ch;
  }
  .crumb {
    font-size: var(--fs-sm);
    color: var(--muted);
    margin-bottom: var(--pad-2);
  }
  .crumb a {
    color: inherit;
  }
  .crumb .sep {
    margin: 0 0.4rem;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-2);
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--pad-2);
  }
  h3 {
    font-size: var(--fs-sm);
    margin: var(--pad-3) 0 0.3rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  .desc {
    color: var(--muted);
    margin: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    padding: 0.15rem 0;
  }
  li a {
    color: inherit;
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
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .muted {
    color: var(--muted);
  }
</style>
