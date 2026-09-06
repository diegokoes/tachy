<script lang="ts">
  import { createSequence } from "../resource.svelte";
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import { isCurator } from "../session.svelte";
  import { Button, Select } from "../tui";
  import type { WikiToc, WikiTocNode, WikiArticleRef } from "../types";

  let { scope }: { scope: string } = $props();

  let toc = $state<WikiToc | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** Slug of the category being renamed/moved; "" while adding a new one. */
  let editing = $state<string | null>(null);
  let form = $state({ slug: "", name: "", parent: "", ordinal: 0 });

  /** Flat list of every category, for the parent picker. */
  function flatten(nodes: WikiTocNode[], depth = 0): { n: WikiTocNode; depth: number }[] {
    return nodes.flatMap((n) => [{ n, depth }, ...flatten(n.children, depth + 1)]);
  }
  const all = $derived(toc ? flatten(toc.categories) : []);

  /** A category cannot move under itself or its own descendant. */
  const subtreeSlugs = (n: WikiTocNode): string[] => [
    n.slug,
    ...n.children.flatMap(subtreeSlugs),
  ];

  function startAdd() {
    editing = "";
    form = { slug: "", name: "", parent: "", ordinal: 0 };
  }

  function startEdit(n: WikiTocNode) {
    editing = n.slug;
    form = {
      slug: n.slug,
      name: n.name,
      parent: all.find((x) => x.n.id === n.parent_id)?.n.slug ?? "",
      ordinal: n.ordinal,
    };
  }

  async function save() {
    if (!form.slug.trim() || !form.name.trim()) return;
    busy = true;
    error = null;
    try {
      if (editing === "") {
        await api.put(`/library/wiki/${scope}/categories`, {
          slug: form.slug.trim(),
          name: form.name.trim(),
          parent: form.parent || null,
          ordinal: form.ordinal,
        });
      } else {
        await api.patch(`/library/wiki/${scope}/categories/${editing}`, {
          slug: form.slug.trim(),
          name: form.name.trim(),
          parent: form.parent || null,
          ordinal: form.ordinal,
        });
      }
      editing = null;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function remove(slug: string) {
    error = null;
    try {
      await api.delete(`/library/wiki/${scope}/categories/${slug}`);
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    void scope;
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
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const openArticle = (a: WikiArticleRef) =>
    navigate(`/library/wiki/${scope}/${a.slug}`);
</script>

{#snippet branch(node: WikiTocNode, depth: number)}
  <li style="--depth: {depth}">
    <button class="cat" onclick={() => navigate(`/library/wiki/${scope}/c/${node.slug}`)}>
      {node.name}
    </button>
    {#if isCurator()}
      <span class="edit">
        <button class="tiny" title="rename or move" onclick={() => startEdit(node)}>edit</button>
        <button
          class="tiny"
          title="remove; its children move up rather than being deleted"
          onclick={() => remove(node.slug)}>remove</button>
      </span>
    {/if}
    {#if node.articles.length}
      <span class="arts">
        {#each node.articles as a, i}
          {#if i > 0}<span class="dot">·</span>{/if}
          <button class="art" onclick={() => openArticle(a)}>{a.title}</button>
        {/each}
      </span>
    {/if}
    {#if node.children.length}
      <ul>
        {#each node.children as child (child.id)}
          {@render branch(child, depth + 1)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<div class="toc">
  <nav class="crumb">
    <a href="/library/wiki/{scope}" onclick={(e) => { e.preventDefault(); navigate(`/library/wiki/${scope}`); }}>
      {scope} wiki
    </a>
    <span class="sep">/</span>
    <span>Table of contents</span>
  </nav>

  <header>
    <h2>Table of contents</h2>
    <span class="acts">
      <Button variant="ghost" size="sm" onclick={() => navigate(`/library/wiki/${scope}/coverage`)}>
        coverage
      </Button>
      {#if isCurator()}
        <Button variant="ghost" size="sm" onclick={() => navigate(`/library/wiki/${scope}/new`)}>
          new article
        </Button>
      {/if}
    </span>
  </header>

  {#if error}<p class="err">{error}</p>{/if}

  {#if isCurator()}
    {#if editing === null}
      <p><button class="tiny" onclick={startAdd}>+ category</button></p>
    {:else}
      <div class="catform">
        <input aria-label="category slug" placeholder="troubleshooting" bind:value={form.slug} />
        <input aria-label="category name" placeholder="Troubleshooting" bind:value={form.name} />
        <Select
          bind:value={form.parent}
          aria-label="parent category"
          options={[
            { value: "", label: "top level" },
            ...all
              .filter(({ n }) => editing === "" || !subtreeSlugs(
                all.find((x) => x.n.slug === editing)!.n,
              ).includes(n.slug))
              .map(({ n, depth }) => ({
                value: n.slug,
                label: `${"  ".repeat(depth)}under ${n.name}`,
              })),
          ]}
        />
        <input
          aria-label="order"
          type="number"
          class="ord"
          title="order among its siblings"
          bind:value={form.ordinal}
        />
        <Button size="sm" variant="primary" busy={busy} onclick={save}>
          {editing === "" ? "add" : "save"}
        </Button>
        <Button size="sm" variant="ghost" onclick={() => (editing = null)}>cancel</Button>
      </div>
    {/if}
  {/if}

  {#if toc}
    {#if toc.categories.length}
      <ul class="tree">
        {#each toc.categories as node (node.id)}
          {@render branch(node, 0)}
        {/each}
      </ul>
    {:else}
      <p class="muted">
        No categories yet. Categories are how a reader navigates this wiki.
      </p>
    {/if}

    {#if toc.uncategorised.length}
      <section class="loose">
        <h3>Uncategorised ({toc.uncategorised.length})</h3>
        <span class="arts">
          {#each toc.uncategorised as a, i}
            {#if i > 0}<span class="dot">·</span>{/if}
            <button class="art" onclick={() => openArticle(a)}>{a.title}</button>
          {/each}
        </span>
      </section>
    {/if}
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</div>

<style>
  .toc {
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
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tree li {
    padding: 0.15rem 0;
  }
  .cat {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: inherit;
    cursor: pointer;
  }
  .cat:hover {
    text-decoration: underline;
  }
  .arts {
    display: inline;
    margin-left: 0.6rem;
    font-size: 0.9em;
    opacity: 0.85;
  }
  .art {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .art:hover {
    text-decoration: underline;
  }
  .dot {
    margin: 0 0.35rem;
    opacity: 0.5;
  }
  .loose {
    margin-top: var(--pad-4);
    border-top: 1px solid var(--line, currentColor);
    padding-top: var(--pad-2);
  }
  .loose h3 {
    font-size: 0.9em;
    margin: 0 0 0.3rem;
  }
  .acts {
    display: flex;
    gap: 0.4rem;
  }
  .tiny {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 0.8em;
    opacity: 0.6;
    color: inherit;
    cursor: pointer;
  }
  .tiny:hover {
    opacity: 1;
    text-decoration: underline;
  }
  .edit {
    display: inline-flex;
    gap: 0.4rem;
    margin-left: 0.5rem;
  }
  .catform {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: var(--pad-2) 0;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line, currentColor);
    flex-wrap: wrap;
  }
  .ord {
    width: 4rem;
  }
  .muted {
    opacity: 0.6;
  }
  .err {
    color: var(--bad, crimson);
  }
</style>
