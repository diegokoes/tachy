<script lang="ts">
  import { slugify } from "@tachy/contract";
  import { createSequence, errText } from "../resource.svelte";
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import { isCurator } from "../session.svelte";
  import { setTopActions } from "../subnav.svelte";
  import { Badge, Button, EmptyState, Note, Select } from "../tui";
  import { G } from "../tui/glyphs";
  import type { WikiToc, WikiTocNode, WikiArticleRef } from "../types";
  import WikiLayout from "./WikiLayout.svelte";
  import { wikiPath } from "./paths";
  import { flattenTree, subtreeSlugs } from "./tree";

  let { scope }: { scope: string } = $props();

  let toc = $state<WikiToc | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** Slug of the category being renamed/moved; "" while adding a new one. */
  let editing = $state<string | null>(null);
  let form = $state({ slug: "", name: "", parent: "", ordinal: 0 });
  let slugTouched = $state(false);
  /** Branches opened by hand. Subcategories start folded, as on the Arch Wiki. */
  let unfolded = $state<Record<string, boolean>>({});

  const all = $derived(toc ? flattenTree(toc.categories) : []);

  const parentOptions = $derived.by(() => {
    const moving = all.find((x) => x.n.slug === editing)?.n;
    const barred = moving ? subtreeSlugs(moving) : [];
    return [
      { value: "", label: "top level" },
      ...all
        .filter(({ n }) => !barred.includes(n.slug))
        .map(({ n, depth }) => ({
          value: n.slug,
          label: `${"  ".repeat(depth)}under ${n.name}`,
        })),
    ];
  });

  function startAdd() {
    editing = "";
    slugTouched = false;
    form = { slug: "", name: "", parent: "", ordinal: 0 };
  }

  function startEdit(n: WikiTocNode) {
    editing = n.slug;
    slugTouched = true;
    form = {
      slug: n.slug,
      name: n.name,
      parent: all.find((x) => x.n.id === n.parent_id)?.n.slug ?? "",
      ordinal: n.ordinal,
    };
  }

  /** The routes take `parentSlug`. zod drops unknown keys without an error,
   *  so a misnamed field makes a move silently do nothing. */
  async function save() {
    const slug = form.slug.trim();
    const name = form.name.trim();
    if (!slug || !name) return;
    busy = true;
    error = null;
    const payload = {
      slug,
      name,
      parentSlug: form.parent || null,
      ordinal: form.ordinal,
    };
    try {
      if (editing === "")
        await api.post(`/library/wiki/${scope}/categories`, payload);
      else
        await api.patch(`/library/wiki/${scope}/categories/${editing}`, payload);
      editing = null;
      await load();
    } catch (e) {
      error = errText(e);
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
      error = errText(e);
    }
  }

  $effect(() => {
    void scope;
    editing = null;
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

  const openArticle = (a: WikiArticleRef) =>
    a.slug && navigate(wikiPath(scope, a.slug));

  $effect(() => {
    if (!isCurator()) return;
    return setTopActions(curate);
  });
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. -->
{#snippet curate()}
  <Button
    variant="ghost"
    tone="ok"
    size="sm"
    icon="plus"
    title="add a category"
    onclick={startAdd}>category</Button
  >
  <Button
    variant="ghost"
    tone="ok"
    size="sm"
    icon="plus"
    title="write a new article"
    onclick={() => navigate(wikiPath(scope, "new"))}>article</Button
  >
{/snippet}

{#snippet article(a: WikiArticleRef)}
  <button class="art" onclick={() => openArticle(a)}>{a.title}</button>
  {#if a.status === "draft"}<Badge tone="accent">draft</Badge>{/if}
  {#if a.stale}
    <Badge tone="warn" title="sources changed since it was written"
      >{a.stale} changed</Badge
    >
  {/if}
{/snippet}

{#snippet branch(node: WikiTocNode, depth: number)}
  {@const open = depth === 0 || !!unfolded[node.id]}
  <li>
    <div class="line">
      <!-- Every nested row keeps the fold column, so a name lines up with its
           siblings whether or not it has anything to unfold. -->
      {#if depth > 0 && node.children.length}
        <button
          class="fold"
          aria-expanded={!!unfolded[node.id]}
          aria-label="{unfolded[node.id] ? 'fold' : 'unfold'} {node.name}"
          onclick={() =>
            (unfolded = { ...unfolded, [node.id]: !unfolded[node.id] })}
          >{unfolded[node.id] ? G.expanded : G.right}</button
        >
      {:else if depth > 0}
        <span class="fold" aria-hidden="true"></span>
      {/if}
      <button
        class="cat"
        class:top={depth === 0}
        onclick={() => navigate(wikiPath(scope, "c", node.slug))}
      >
        {node.name}
      </button>
      {#if isCurator()}
        <span class="edit">
          <button class="tiny" title="rename or move" onclick={() => startEdit(node)}
            >edit</button
          >
          <button
            class="tiny"
            title="remove; children move up"
            onclick={() => remove(node.slug)}>remove</button
          >
        </span>
      {/if}
    </div>
    {#if node.articles.length}
      <span class="arts" class:under={depth > 0}>
        {#each node.articles as a, i (a.id)}
          {#if i > 0}<span class="dot">·</span>{/if}
          {@render article(a)}
        {/each}
      </span>
    {/if}
    {#if node.children.length && open}
      <ul>
        {#each node.children as child (child.id)}
          {@render branch(child, depth + 1)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<WikiLayout {scope}>
  <div class="toc">
    <h2>Contents</h2>

    {#if error}<Note tone="danger">{error}</Note>{/if}

    {#if isCurator() && editing !== null}
      <div class="catform">
        <input
          aria-label="category name"
          placeholder="Troubleshooting"
          bind:value={form.name}
          oninput={() => {
            if (!slugTouched) form.slug = slugify(form.name);
          }}
        />
        <input
          aria-label="category slug"
          placeholder="troubleshooting"
          bind:value={form.slug}
          oninput={() => (slugTouched = true)}
        />
        <Select
          bind:value={form.parent}
          aria-label="parent category"
          options={parentOptions}
        />
        <input
          aria-label="order"
          type="number"
          class="ord"
          title="order among its siblings"
          bind:value={form.ordinal}
        />
        <Button size="sm" variant="primary" {busy} onclick={save}>
          {editing === "" ? "add" : "save"}
        </Button>
        <Button size="sm" variant="ghost" onclick={() => (editing = null)}
          >cancel</Button
        >
      </div>
    {/if}

    {#if toc}
      {#if toc.categories.length}
        <ul class="tree">
          {#each toc.categories as node (node.id)}
            {@render branch(node, 0)}
          {/each}
        </ul>
      {:else}
        <EmptyState
          icon="index"
          title="No categories yet."
          detail="Add one top right, or let the agent propose them."
        />
      {/if}

      {#if toc.uncategorised.length}
        <section class="loose">
          <h3>Uncategorised ({toc.uncategorised.length})</h3>
          <span class="arts">
            {#each toc.uncategorised as a, i (a.id)}
              {#if i > 0}<span class="dot">·</span>{/if}
              {@render article(a)}
            {/each}
          </span>
        </section>
      {/if}
    {:else if !error}
      <p class="muted">loading…</p>
    {/if}
  </div>
</WikiLayout>

<style>
  .toc {
    max-width: 78ch;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-3);
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--pad-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  ul ul {
    padding-left: 1.2rem;
  }
  .tree > li {
    padding: var(--pad-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .tree li li {
    padding: 0.15rem 0;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: var(--pad-1);
  }
  .fold {
    flex: none;
    width: 1em;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-family: var(--font-mono);
    color: var(--muted);
    cursor: pointer;
  }
  .fold:hover {
    color: var(--accent);
  }
  .cat,
  .art {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .cat {
    font-weight: 600;
  }
  .cat.top {
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  .cat:hover,
  .art:hover {
    text-decoration: underline;
  }
  .arts {
    display: block;
    margin: 0.2rem 0 0 1.2rem;
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  /* Past the fold column, so a nested category's articles sit under its name. */
  .arts.under {
    margin-left: calc(1em + var(--pad-1) + 0.8rem);
  }
  .art {
    color: var(--text);
  }
  .dot {
    margin: 0 0.35rem;
  }
  .loose {
    margin-top: var(--pad-4);
  }
  .loose h3 {
    font-size: var(--fs-sm);
    margin: 0 0 0.3rem;
    color: var(--muted);
  }
  .tiny {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--muted);
    cursor: pointer;
  }
  .tiny:hover {
    color: var(--text);
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
    margin: 0 0 var(--pad-3);
    padding: var(--pad-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    flex-wrap: wrap;
  }
  .ord {
    width: 4rem;
  }
  .muted {
    color: var(--muted);
  }
</style>
