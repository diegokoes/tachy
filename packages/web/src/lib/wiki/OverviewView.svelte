<script lang="ts">
  import { MAIN_PAGE_SLUG, slugify } from "@tachy/contract";
  import { createSequence, errText } from "../resource.svelte";
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import { isCurator } from "../session.svelte";
  import { setTopActions } from "../subnav.svelte";
  import { renderMarkdown, markBrokenLinks } from "../markdown";
  import { LinkTargets } from "../wikilinks.svelte";
  import { Badge, Button, Checkbox, Chevron, EmptyState, Note, Select } from "../tui";
  import type {
    Coverage,
    CoverageNode,
    ReferenceRow,
    WikiGaps,
    WikiTocNode,
    WikiToc,
    WikiArticleRef,
  } from "../types";
  import WikiLayout from "./WikiLayout.svelte";
  import { wikiPath } from "./paths";
  import { flattenTree, subtreeSlugs } from "./tree";
  import { loadWikis } from "./wikis.svelte";

  let { scope }: { scope: string } = $props();

  let intro = $state<ReferenceRow | null>(null);
  let toc = $state<WikiToc | null>(null);
  let coverage = $state<Coverage | null>(null);
  let gaps = $state<WikiGaps["gaps"]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const links = new LinkTargets();

  const introHtml = $derived(
    intro
      ? markBrokenLinks(renderMarkdown(intro.body ?? ""), links.resolved)
      : "",
  );

  /* Section CRUD lives on the landing, where the tree it edits is in view. */
  let editing = $state<string | null>(null);
  let form = $state({
    slug: "",
    name: "",
    parent: "",
    ordinal: 0,
    leadSlug: "",
    componentSlugs: [] as string[],
  });
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

  /** Every article in this wiki, for the lead-article picker. */
  const articles = $derived.by(() => {
    const out: WikiArticleRef[] = [];
    const walk = (ns: WikiTocNode[]) => {
      for (const n of ns) {
        for (const a of n.articles) if (a.slug) out.push(a);
        walk(n.children);
      }
    };
    if (toc) {
      walk(toc.categories);
      for (const a of toc.uncategorised) if (a.slug) out.push(a);
    }
    const seen = new Set<string>();
    return out.filter((a) => a.slug && !seen.has(a.slug) && seen.add(a.slug));
  });

  const leadOptions = $derived([
    { value: "", label: "— no lead page —" },
    ...articles.map((a) => ({ value: a.slug as string, label: a.title })),
  ]);

  /** Coverage nodes by component slug, for section badges and the strip. */
  const covBySlug = $derived.by(() => {
    const m = new Map<string, CoverageNode>();
    const walk = (ns: CoverageNode[]) => {
      for (const n of ns) {
        m.set(n.slug, n);
        walk(n.children);
      }
    };
    if (coverage) walk(coverage.nodes);
    return m;
  });

  const componentList = $derived([...covBySlug.values()]);

  /** Every component slug a section covers, its subtrees unioned and deduped. */
  function coveredSlugs(componentSlugs: string[]): Set<string> {
    const seen = new Set<string>();
    const walk = (n: CoverageNode) => {
      if (seen.has(n.slug)) return;
      seen.add(n.slug);
      n.children.forEach(walk);
    };
    for (const s of componentSlugs) {
      const n = covBySlug.get(s);
      if (n) walk(n);
    }
    return seen;
  }

  /** A section's at-a-glance state, from the components it links. */
  function sectionBadge(
    node: WikiTocNode,
  ): { articles: number; gaps: number } | null {
    const comps = node.components ?? [];
    if (!comps.length || !coverage) return null;
    const covered = coveredSlugs(comps.map((c) => c.slug));
    let articles = 0;
    for (const s of covered) articles += covBySlug.get(s)?.articles ?? 0;
    const g = gaps.filter(
      (x) =>
        (x.kind === "unwritten" || x.kind === "outgrown") &&
        x.evidence.component &&
        covered.has(String(x.evidence.component)),
    ).length;
    return { articles, gaps: g };
  }

  /** A section opens its lead article when it has one, else its plain page. */
  const sectionHref = (n: WikiTocNode) =>
    n.lead_slug ? wikiPath(scope, n.lead_slug) : wikiPath(scope, "c", n.slug);

  function startAdd() {
    editing = "";
    slugTouched = false;
    form = {
      slug: "",
      name: "",
      parent: "",
      ordinal: 0,
      leadSlug: "",
      componentSlugs: [],
    };
  }

  function startEdit(n: WikiTocNode) {
    editing = n.slug;
    slugTouched = true;
    form = {
      slug: n.slug,
      name: n.name,
      parent: all.find((x) => x.n.id === n.parent_id)?.n.slug ?? "",
      ordinal: n.ordinal,
      leadSlug: n.lead_slug ?? "",
      componentSlugs: (n.components ?? []).map((c) => c.slug),
    };
  }

  function toggleComponent(slug: string) {
    form.componentSlugs = form.componentSlugs.includes(slug)
      ? form.componentSlugs.filter((s) => s !== slug)
      : [...form.componentSlugs, slug];
  }

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
      leadSlug: form.leadSlug || null,
      componentSlugs: form.componentSlugs,
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

  async function seed() {
    busy = true;
    error = null;
    try {
      await api.post(`/library/wiki/${scope}/sections/seed`, {});
      await load();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
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
      const [main, nextToc, sweep] = await Promise.all([
        api.get<ReferenceRow | null>(`/library/wiki/${scope}/main`),
        api.get<WikiToc>(`/library/wiki/${scope}/toc`),
        api.get<WikiGaps>(`/library/wiki/${scope}/gaps`),
      ]);
      if (!isCurrent()) return;
      intro = main;
      toc = nextToc;
      coverage = sweep.coverage;
      gaps = sweep.gaps;
      if (main) await links.load("reference", main.id);
    } catch (e) {
      if (!isCurrent()) return;
      error = errText(e);
    }
  }

  /** A red link on the intro is a page a curator can start, as in the reader. */
  function onIntroClick(e: MouseEvent) {
    const el = (e.target as HTMLElement)?.closest?.("a.wikilink.broken");
    const target = el?.getAttribute("data-wikilink");
    if (target && isCurator() && !/^(entry|doc):/.test(target)) {
      e.preventDefault();
      navigate(wikiPath(scope, "new", slugify(target)));
      return;
    }
    links.onClick(e);
  }

  const openArticle = (a: WikiArticleRef) =>
    a.slug && navigate(wikiPath(scope, a.slug));

  const hasComponents = $derived(componentList.length > 0);

  $effect(() => {
    if (!isCurator()) return;
    return setTopActions(curate);
  });
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. -->
{#snippet curate()}
  {#if hasComponents && !toc?.categories.length}
    <Button
      variant="ghost"
      tone="ok"
      size="sm"
      icon="seed"
      title="one section per top-level component"
      {busy}
      onclick={seed}>seed from components</Button
    >
  {/if}
  <Button
    variant="ghost"
    tone="ok"
    size="sm"
    icon="plus"
    title="add a section"
    onclick={startAdd}>section</Button
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
  {@const badge = depth === 0 ? sectionBadge(node) : null}
  <li>
    <div class="line">
      {#if depth > 0 && node.children.length}
        <button
          class="fold"
          aria-expanded={!!unfolded[node.id]}
          aria-label="{unfolded[node.id] ? 'fold' : 'unfold'} {node.name}"
          onclick={() =>
            (unfolded = { ...unfolded, [node.id]: !unfolded[node.id] })}
          ><Chevron open={!!unfolded[node.id]} /></button
        >
      {:else if depth > 0}
        <span class="fold" aria-hidden="true"></span>
      {/if}
      <button
        class="cat"
        class:top={depth === 0}
        onclick={() => navigate(sectionHref(node))}
      >
        {node.name}
      </button>
      {#if badge}
        <span class="badge" title="articles · open gaps for this section">
          {badge.articles} art{#if badge.gaps}
            <span class="gap">· {badge.gaps} gap{badge.gaps === 1 ? "" : "s"}</span
            >{/if}
        </span>
      {/if}
      {#if node.lead_slug}
        <span class="lead" title="this section has a lead page">lead</span>
      {/if}
      {#if isCurator()}
        <span class="edit">
          <button class="tiny" title="rename, move or set lead" onclick={() => startEdit(node)}
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
  <div class="overview">
    {#if error}<Note tone="danger">{error}</Note>{/if}

    <!-- The intro: the product's own words, ahead of the generated structure. -->
    <section class="intro">
      {#if intro}
        <header>
          <h2>{intro.title}</h2>
          {#if isCurator()}
            <Button
              size="sm"
              tone="info"
              icon="edit"
              title="edit the intro"
              onclick={() => navigate(wikiPath(scope, MAIN_PAGE_SLUG, "edit"))}
              >edit</Button
            >
          {/if}
        </header>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="wiki-body md"
          onclick={onIntroClick}
          onkeydown={links.onKeydown}
        >
          {@html introHtml}
        </div>
      {:else if toc}
        <EmptyState
          icon="file"
          title="No intro yet."
          detail="A short landing: what this product is, and where to start."
        >
          {#if isCurator()}
            <Button
              variant="primary"
              icon="edit"
              onclick={() => navigate(wikiPath(scope, "new", MAIN_PAGE_SLUG))}
              >write intro</Button
            >
          {/if}
        </EmptyState>
      {/if}
    </section>

    <!-- Section editor, when adding or editing one. -->
    {#if isCurator() && editing !== null}
      <div class="catform">
        <div class="row">
          <input
            aria-label="section name"
            placeholder="Portal"
            bind:value={form.name}
            oninput={() => {
              if (!slugTouched) form.slug = slugify(form.name);
            }}
          />
          <input
            aria-label="section slug"
            placeholder="portal"
            bind:value={form.slug}
            oninput={() => (slugTouched = true)}
          />
          <Select
            bind:value={form.parent}
            aria-label="parent section"
            options={parentOptions}
          />
          <input
            aria-label="order"
            type="number"
            class="ord"
            title="order among its siblings"
            bind:value={form.ordinal}
          />
        </div>
        <div class="row">
          <span class="lbl">lead page</span>
          <Select
            bind:value={form.leadSlug}
            aria-label="lead article"
            options={leadOptions}
            searchable
          />
        </div>
        {#if hasComponents}
          <div class="comps">
            <span class="lbl">covers components</span>
            <div class="checks">
              {#each componentList as c (c.id)}
                <span class="ck">
                  <Checkbox
                    checked={form.componentSlugs.includes(c.slug)}
                    ariaLabel={c.name}
                    onchange={() => toggleComponent(c.slug)}
                  />
                  <button
                    type="button"
                    class="cklbl"
                    onclick={() => toggleComponent(c.slug)}>{c.name}</button
                  >
                </span>
              {/each}
            </div>
          </div>
        {/if}
        <div class="row">
          <Button size="sm" variant="primary" {busy} onclick={save}>
            {editing === "" ? "add" : "save"}
          </Button>
          <Button size="sm" variant="ghost" onclick={() => (editing = null)}
            >cancel</Button
          >
        </div>
      </div>
    {/if}

    <!-- The sections: this wiki's contents, Arch-style. -->
    {#if toc}
      <section class="sections">
        <h3>Sections</h3>
        {#if toc.categories.length}
          <ul class="tree">
            {#each toc.categories as node (node.id)}
              {@render branch(node, 0)}
            {/each}
          </ul>
        {:else}
          <EmptyState
            icon="overview"
            title="No sections yet."
            detail={hasComponents
              ? "Seed them from the components, top right, or add one by hand."
              : "Add one top right, or let the agent propose them."}
          />
        {/if}

        {#if toc.uncategorised.length}
          <div class="loose">
            <h4>Uncategorised ({toc.uncategorised.length})</h4>
            <span class="arts">
              {#each toc.uncategorised as a, i (a.id)}
                {#if i > 0}<span class="dot">·</span>{/if}
                {@render article(a)}
              {/each}
            </span>
          </div>
        {/if}
      </section>

      <!-- The product's real structure, mirrored: coverage per component, with
           a way through to the map that owns it. -->
      {#if coverage && componentList.length}
        <section class="strip">
          <h3>
            Components
            {#if isCurator()}
              <a
                class="mapl"
                href="/admin/components"
                onclick={(e) => {
                  e.preventDefault();
                  navigate("/admin/components");
                }}>open in Components map →</a
              >
            {/if}
          </h3>
          <ul class="cov">
            {#each coverage.nodes as n (n.id)}
              <li>
                <span class="cname">{n.name}</span>
                <span class="counts">
                  {n.subtree.entries} lessons · {n.subtree.docs} docs · {n
                    .subtree.articles} articles
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {:else if !error}
      <p class="muted">loading…</p>
    {/if}
  </div>
</WikiLayout>

<style>
  .overview {
    max-width: 82ch;
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
  }
  .intro header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--pad-3);
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--pad-2);
    margin-bottom: var(--pad-2);
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0;
  }
  h3 {
    font-size: var(--fs-sm);
    margin: 0 0 var(--pad-2);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
    color: var(--muted);
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--pad-3);
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--pad-1);
  }
  .mapl {
    font-size: var(--fs-xs);
    text-transform: none;
    letter-spacing: normal;
    color: var(--muted);
  }
  .mapl:hover {
    color: var(--accent);
  }
  .wiki-body {
    line-height: 1.6;
  }
  .wiki-body :global(a.wikilink) {
    cursor: pointer;
    text-decoration: underline;
  }
  .wiki-body :global(a.wikilink.broken) {
    color: var(--danger);
    text-decoration: underline dotted;
  }
  .wiki-body :global(pre) {
    overflow-x: auto;
    padding: var(--pad-2) var(--pad-3);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
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
  .badge {
    font-size: var(--fs-xs);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .badge .gap {
    color: var(--warn);
  }
  .lead {
    font-size: var(--fs-xs);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  .arts {
    display: block;
    margin: 0.2rem 0 0 1.2rem;
    font-size: var(--fs-sm);
    color: var(--muted);
  }
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
    margin-top: var(--pad-3);
  }
  .loose h4 {
    font-size: var(--fs-sm);
    margin: 0 0 0.3rem;
    color: var(--muted);
    font-weight: 400;
  }
  .cov {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .cov li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--pad-3);
    padding: 0.15rem 0;
  }
  .cname {
    font-weight: 600;
  }
  .counts {
    font-size: var(--fs-xs);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
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
    flex-direction: column;
    gap: var(--pad-2);
    padding: var(--pad-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .catform .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .catform .lbl,
  .comps .lbl {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .comps {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem var(--pad-3);
  }
  .ck {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .cklbl {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .cklbl:hover {
    text-decoration: underline;
  }
  .ord {
    width: 4rem;
  }
  .muted {
    color: var(--muted);
  }
</style>
