<script lang="ts">
  import { KNOWLEDGE_STATUSES, REFERENCE_STATUSES } from "../vocab";
  import { onMount } from "svelte";
  import { api } from "../api";
  import type { KnowledgeRow, NamedRow, ReferenceRow } from "../types";
  import { navigate, segment } from "../router.svelte";
  import { setSubnav } from "../subnav.svelte";
  import { pushScope } from "../keys.svelte";
  import { vimState } from "../vim.svelte";
  import { growBar } from "../motion";
  import { entryText, excerpt, type Seg } from "./matching";
  import { isCurator } from "../session.svelte";
  import { t } from "../terms";
  import { errText } from "../resource.svelte";
  import { componentOptions } from "../catalog";
  import { Button, Chip, EmptyState, Note, Select, Spinner } from "../tui";
  import FilterMenu from "./FilterMenu.svelte";
  import TagFilter from "./TagFilter.svelte";
  import {
    applyExtras,
    byKey,
    loadFilters,
    pruneValues,
    saveFilters,
    type FacetKey,
    type Facets,
  } from "./filters.svelte";
  import EntryDetail from "../EntryDetail.svelte";
  import DocDetail from "./DocDetail.svelte";
  import WikiView from "../wiki/WikiView.svelte";
  import EntryForm from "../knowledge/EntryForm.svelte";
  import ReferenceForm from "../reference/ReferenceForm.svelte";

  type Item = {
    kind: "entry" | "doc" | "article";
    id: string;
    /** Articles are addressed by slug within a wiki, not by id. */
    slug?: string;
    productId?: string;
    title: string;
    status: string;
    /** Query-centred excerpt of the matching chunk, split on the hits. */
    snippet?: Seg[];
    /** Top-right of the card: doc version, or an entry's version span. */
    version?: string;
    updated?: string;
    tags: string[];
    /** Set when the item describes one customer's install rather than the product. */
    customer?: string | null;
    /** Server-calibrated 0-1 match strength — what the gauge draws. */
    relevance?: number;
    /** "strong" | "good" | "weak", from the same calibration. */
    grade?: string;
    sortAt: number;
  };

  // The section's places, rendered as the subnav across the window's top edge.
  // Keys are URL segments and labels are not: the segment stays 'entries' so
  // existing links keep resolving, while the tab reads 'knowledge'.
  //
  // 'all' is the landing on purpose. Entries and docs are one corpus that
  // search spans; splitting them is an optional narrowing, never a gate you
  // have to pass to see anything. The wiki is the odd one out — a place rather
  // than a search scope, so picking it leaves the result list entirely and its
  // own pages take over.
  const KINDS = [
    { key: "all", label: "all" },
    { key: "entries", label: "knowledge" },
    { key: "docs", label: "docs" },
    { key: "wiki", label: "wiki" },
  ];

  // From vocab.ts, which exists so these are written once: the hand-typed
  // copies had drifted out of the order the contract documents as the order
  // they should be offered in.
  const STATUSES = KNOWLEDGE_STATUSES;
  const DOC_STATUSES = REFERENCE_STATUSES;

  const kind = $derived(segment(1) ?? "all");
  const param = $derived(segment(2));
  const listing = $derived(
    kind === "new" || kind === "wiki" ? false : !param || kind === "all",
  );

  /** The tab a detail view was opened from, so "back" returns there. */
  let origin = $state("all");

  $effect(() =>
    setSubnav({
      items: KINDS,
      active: kind === "new" ? origin : kind,
      onpick: (k) => navigate(k === "all" ? "/library" : `/library/${k}`),
      // Only over a list. A detail view claims the row for itself, and a
      // create screen has nothing to create from.
      actions: listing && isCurator() ? newAction : undefined,
    }),
  );
  /** Which form the create screen shows — in the URL, so it deep-links. */
  const newKind = $derived(param === "doc" ? "doc" : "entry");

  let q = $state("");
  let status = $state("");
  let productId = $state("");
  let component = $state("");
  let version = $state("");

  let products = $state<NamedRow[]>([]);
  let components = $state<NamedRow[]>([]);

  /** Counts for every facet under whatever else is currently selected. */
  let facets = $state<Facets>({});
  /** Which extra filters the user added, and to what — persisted per browser. */
  let shown = $state<FacetKey[]>([]);
  let extras = $state<Record<string, string>>({});
  const versions = $derived(facets.affected_version ?? []);

  let items = $state<Item[]>([]);
  // Starts true so the first paint shows nothing rather than the empty state.
  let loading = $state(true);
  let slow = $state(false);
  let error = $state<string | null>(null);
  let mode = $state<"search" | "browse">("browse");
  /** -1 = nothing highlighted yet. The first j/k/arrow lands on the top row. */
  let cursor = $state(-1);
  let rowEls = $state<(HTMLElement | undefined)[]>([]);
  /**
   * Keyboard navigation scrolls the list under a stationary pointer, and the
   * browser fires mouseenter for that — which would yank the cursor back to
   * wherever the mouse happens to sit. Ignore hover until the mouse really moves.
   */
  let pointerMoved = $state(true);

  function moveCursor(delta: number) {
    pointerMoved = false;
    cursor = cursor < 0 ? 0 : Math.min(items.length - 1, Math.max(0, cursor + delta));
    rowEls[cursor]?.scrollIntoView({ block: "nearest" });
  }

  function jumpCursor(to: number) {
    pointerMoved = false;
    cursor = Math.min(items.length - 1, Math.max(0, to));
    rowEls[cursor]?.scrollIntoView({ block: "nearest" });
  }
  let searchEl = $state<HTMLInputElement>();

  let createSaving = $state(false);
  let createError = $state<string | null>(null);

  const showEntryFilters = $derived(kind === "entries");
  const showDocFilters = $derived(kind === "docs");
  /**
   * Counts hidden filters too: the entry-only ones still travel on entryQs, so
   * a filter you cannot see must stay clearable — otherwise the list is
   * silently narrowed with no way out.
   */
  const activeFilters = $derived(
    [productId, component, version, status].filter(Boolean).length +
      shown.filter((k) => extras[k]).length,
  );

  function scopeQs(p: URLSearchParams) {
    if (q.trim()) p.set("q", q.trim());
    if (productId) p.set("product_id", productId);
    if (productId && component) p.set("component", component);
    if (status && !q.trim()) p.set("status", status);
    return p;
  }

  function entryQs() {
    const p = scopeQs(new URLSearchParams());
    if (version) p.set("affected_version", version);
    return applyExtras(p, shown, extras).toString();
  }

  const docQs = () => scopeQs(new URLSearchParams()).toString();

  const at = (d?: string) => (d ? Date.parse(d) || 0 : 0);
  const fmtDate = (d?: string) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  const fill = (v: number) => Math.max(3, v * 100);

  function versionSpan(r: KnowledgeRow) {
    if (r.affected_version && r.fixed_version)
      return `${r.affected_version} → ${r.fixed_version}`;
    if (r.affected_version) return r.affected_version;
    if (r.fixed_version) return `fixed ${r.fixed_version}`;
    return undefined;
  }

  function toEntry(r: KnowledgeRow, query: string): Item {
    const text = entryText(
      [r.root_cause, r.resolution, (r.signals ?? []).join(" · ")],
      query,
    );
    return {
      kind: "entry",
      id: r.id,
      title: r.issue_summary ?? "(no summary)",
      status: r.status,
      snippet: text ? excerpt(text, query) : undefined,
      version: versionSpan(r),
      updated: fmtDate(r.updated_at ?? r.created_at),
      tags: (r.tags ?? []).slice(0, 5),
      customer: r.customer_slug,
      relevance: r.relevance,
      grade: r.grade,
      sortAt: at(r.updated_at ?? r.created_at),
    };
  }

  function toDoc(r: ReferenceRow, query: string): Item {
    return {
      kind: r.kind === "wiki" ? "article" : "doc",
      id: r.id,
      slug: r.slug ?? undefined,
      productId: r.product_id ?? undefined,
      title: r.title,
      status: r.status,
      snippet: r.snippet ? excerpt(r.snippet, query) : undefined,
      version: r.doc_version ? `v${r.doc_version}` : undefined,
      updated: fmtDate(r.updated_at ?? r.created_at),
      tags: (r.tags ?? []).slice(0, 6),
      customer: r.customer_slug,
      relevance: r.relevance,
      grade: r.grade,
      sortAt: at(r.updated_at ?? r.created_at),
    };
  }

  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;

  async function run() {
    const mine = ++seq;
    loading = true;
    error = null;

    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => {
      if (mine === seq && loading) slow = true;
    }, 400);
    mode = q.trim() ? "search" : "browse";
    const searching = mode === "search";

    try {
      const wantEntries = kind !== "docs";
      const wantDocs = kind !== "entries";
      const [ents, docs] = await Promise.all([
        wantEntries
          ? api.get<KnowledgeRow[]>(
              `/knowledge${searching ? "/search" : ""}?${entryQs()}`,
            )
          : Promise.resolve([]),
        wantDocs
          ? api.get<ReferenceRow[]>(
              `/reference${searching ? "/search" : ""}?${docQs()}`,
            )
          : Promise.resolve([]),
      ]);
      if (mine !== seq) return;

      const query = searching ? q.trim() : "";
      let merged = [
        ...ents.map((e) => toEntry(e, query)),
        ...docs.map((d) => toDoc(d, query)),
      ];
      if (searching && status) merged = merged.filter((i) => i.status === status);

      merged.sort((a, b) =>
        searching
          ? (b.relevance ?? 0) - (a.relevance ?? 0)
          : b.sortAt - a.sortAt,
      );
      items = merged;
      cursor = -1;
      rowEls = [];
    } catch (e) {
      if (mine === seq) error = errText(e);
    } finally {
      if (mine === seq) {
        clearTimeout(slowTimer);
        loading = false;
        slow = false;
      }
    }
  }

  async function loadCatalog() {
    try {
      products = await api.get<NamedRow[]>("/products");
    } catch {
      products = [];
    }
    await loadFacets();
  }

  /**
   * Every filter's options, narrowed by everything else that is selected — a
   * filter offering a value with no rows behind it is worse than no filter.
   * Each facet is counted with its own selection lifted, so its other options
   * stay reachable once one is picked.
   */
  async function loadFacets() {
    const p = new URLSearchParams();
    if (productId) p.set("product_id", productId);
    if (productId && component) p.set("component", component);
    if (status) p.set("status", status);
    if (version) p.set("affected_version", version);
    applyExtras(p, shown, extras);
    try {
      facets = await api.get<Facets>(`/knowledge/facets?${p}`);
    } catch {
      facets = {};
    }
    if (version && !versions.some((v) => v.value === version)) version = "";
    extras = pruneValues(shown, extras, facets);
  }

  function addFilter(key: FacetKey) {
    shown = [...shown, key];
    persist();
    void loadFacets();
  }

  function removeFilter(key: FacetKey) {
    shown = shown.filter((k) => k !== key);
    const { [key]: _dropped, ...rest } = extras;
    extras = rest;
    persist();
  }

  function setExtra(key: FacetKey, value: string) {
    extras = { ...extras, [key]: value };
    persist();
  }

  const persist = () => saveFilters({ shown, values: extras });

  async function onProductChange(id: string) {
    component = "";
    components = [];
    const slug = products.find((p) => p.id === id)?.slug;
    if (slug)
      try {
        components = await api.get<NamedRow[]>(`/products/${slug}/components`);
      } catch {
        components = [];
      }
    await loadFacets();
  }

  function clearFilters() {
    productId = "";
    component = "";
    components = [];
    status = "";
    version = "";
    extras = {};
    persist();
    void loadFacets();
  }

  function openItem(i: Item) {
    origin = kind;
    if (i.kind === "article" && i.slug) {
      const scope =
        products.find((p) => p.id === i.productId)?.slug ?? "general";
      navigate(`/library/wiki/${scope}/${i.slug}`);
      return;
    }
    navigate(`/library/${i.kind === "entry" ? "entries" : "docs"}/${i.id}`);
  }

  /** Back from a detail returns to the tab you opened it from, not its kind. */
  function backToList() {
    navigate(origin === "all" ? "/library" : `/library/${origin}`);
  }

  async function createEntry(payload: Record<string, unknown>) {
    createSaving = true;
    createError = null;
    try {
      const created = await api.post<{ id: string }>("/knowledge", payload);
      navigate(`/library/entries/${created.id}`);
    } catch (e) {
      createError = errText(e);
    } finally {
      createSaving = false;
    }
  }

  async function createDoc(payload: Record<string, unknown>) {
    createSaving = true;
    createError = null;
    try {
      const created = await api.post<{ id: string }>("/reference", payload);
      navigate(`/library/docs/${created.id}`);
    } catch (e) {
      createError = errText(e);
    } finally {
      createSaving = false;
    }
  }

  onMount(() => {
    const stored = loadFilters();
    shown = stored.shown;
    extras = stored.values;
    void loadCatalog();
  });

  let ranOnce = false;
  $effect(() => {
    if (!listing) return;
    void q;
    void kind;
    void status;
    void productId;
    void component;
    void version;
    void shown;
    void extras;
    clearTimeout(timer);
    loading = true;
    timer = setTimeout(run, ranOnce ? 250 : 0);
    ranOnce = true;
    return () => clearTimeout(timer);
  });

  /**
   * Re-count the options whenever the narrowing changes — but not on `extras`,
   * which loadFacets itself prunes; depending on it here would loop.
   */
  let facetsOnce = false;
  $effect(() => {
    void status;
    void version;
    if (!facetsOnce) {
      facetsOnce = true;
      return;
    }
    void loadFacets();
  });

  $effect(() => {
    if (!listing) return;
    return pushScope([
      {
        key: "ctrl+k",
        label: "",
        hidden: true,
        inFields: true,
        run: () => searchEl?.focus(),
      },
      {
        key: "j",
        label: "",
        hidden: true,
        run: () => moveCursor(1),
      },
      {
        key: "k",
        label: "",
        hidden: true,
        run: () => moveCursor(-1),
      },
      {
        key: "↓",
        label: "",
        hidden: true,
        run: () => moveCursor(1),
      },
      {
        key: "↑",
        label: "",
        hidden: true,
        run: () => moveCursor(-1),
      },
      {
        key: "⏎",
        label: "",
        hidden: true,
        run: () => items[cursor] && openItem(items[cursor]),
      },
      // j/k and the arrows are always on — they cost nothing and cannot be
      // typed by accident outside a field. The rest is vim-mode only, because
      // g, G and / are keys someone who did not ask for vim would rather have.
      ...(vimState.enabled
        ? [
            { key: "g g", label: "", hidden: true, run: () => jumpCursor(0) },
            {
              key: "shift+g",
              label: "",
              hidden: true,
              run: () => jumpCursor(items.length - 1),
            },
            {
              key: "/",
              label: "",
              hidden: true,
              run: () => searchEl?.focus(),
            },
            /*
             * n/N step the matches, and only mean that with a query on — but
             * the check belongs inside `run`, not in the effect body. Read out
             * here it made `q` a dependency of the whole scope, so every
             * keystroke in the search box tore down and re-registered all
             * eleven bindings; and because pushScope appends while resolution
             * runs innermost-first, each re-push promoted these above any scope
             * opened since.
             */
            {
              key: "n",
              label: "",
              hidden: true,
              run: () => q.trim() && moveCursor(1),
            },
            {
              key: "shift+n",
              label: "",
              hidden: true,
              run: () => q.trim() && moveCursor(-1),
            },
          ]
        : []),
    ]);
  });
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. -->
{#snippet newAction()}
  <Button
    tone="ok"
    icon="plus"
    title="new entry or doc"
    onclick={() => navigate("/library/new/entry")}>new</Button
  >
{/snippet}

{#snippet kindToggle()}
  <span class="toggle">
    <Button
      variant={newKind === "entry" ? "primary" : "ghost"}
      square
      icon="analyze"
      title="knowledge entry"
      aria-label="knowledge entry"
      onclick={() => navigate("/library/new/entry")}
    />
    <Button
      variant={newKind === "doc" ? "primary" : "ghost"}
      square
      icon="doc"
      title="reference doc"
      aria-label="reference doc"
      onclick={() => navigate("/library/new/doc")}
    />
  </span>
{/snippet}

{#if kind === "wiki"}
  <WikiView />
{:else if kind === "entries" && param}
  <EntryDetail
    id={param}
    onClose={backToList}
    onOpen={(id) => navigate(`/library/entries/${id}`)}
  />
{:else if kind === "docs" && param}
  <DocDetail id={param} onClose={backToList} />
{:else if kind === "new"}
  {#if newKind === "doc"}
    <ReferenceForm
      mode="create"
      saving={createSaving}
      error={createError}
      onSubmit={createDoc}
      onCancel={() => navigate("/library")}
      extra={kindToggle}
    />
  {:else}
    <EntryForm
      mode="create"
      saving={createSaving}
      error={createError}
      onSubmit={createEntry}
      onCancel={() => navigate("/library")}
      extra={kindToggle}
    />
  {/if}
{:else}
  <div class="bar">
    <input
      bind:this={searchEl}
      class="search"
      placeholder="Search symptoms, error codes, root causes, docs…"
      bind:value={q}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          clearTimeout(timer);
          run();
        }
      }}
    />
  </div>

  <!-- The default row stays deliberately short. Everything else the schema can
       be narrowed by — environment, confidence, clarity, pattern, hidden fix,
       fixed version, tags — is one `+` away and remembered per browser. -->
  <div class="filters">
    <!-- product and component scope entries AND docs, so they stay visible in
         every mode; version and value exist only on entries. -->
    <Select
      bind:value={productId}
      active={!!productId}
      title={t("product")}
      options={[
        { value: "", label: `any ${t("product")}` },
        ...products.map((p) => ({
          value: p.id as string,
          label: p.name as string,
        })),
      ]}
      onchange={(v) => onProductChange(String(v))}
    />
    <Select
      bind:value={component}
      active={!!component}
      title={`Component (within the chosen ${t("product")})`}
      disabled={!productId || components.length === 0}
      options={[
        { value: "", label: "any component" },
        ...componentOptions(components),
      ]}
      onchange={() => loadFacets()}
    />

    {#if showEntryFilters}
      <Select
        bind:value={version}
        active={!!version}
        title="Affected version"
        disabled={versions.length === 0}
        options={[
          { value: "", label: "any version" },
          ...versions.map((v) => ({
            value: v.value,
            label: `${v.value} (${v.count})`,
          })),
        ]}
      />
    {/if}

    <Select
      bind:value={status}
      active={!!status}
      title="Status"
      options={[
        { value: "", label: "any status" },
        ...(showDocFilters ? DOC_STATUSES : STATUSES),
      ]}
    />

    {#if showEntryFilters}
      {#each shown as key (key)}
        {@const def = byKey(key)}
        {#if def}
          <span class="extra">
            {#if def.kind === "tags"}
              <TagFilter
                value={extras[key] ?? ""}
                options={facets.tags ?? []}
                onchange={(v) => setExtra(key, v)}
              />
            {:else}
              <Select
                value={extras[key] ?? ""}
                active={!!extras[key]}
                title={def.label}
                options={[
                  { value: "", label: def.any },
                  ...(def.kind === "enum"
                    ? (def.options ?? []).map((o) => ({ value: o, label: o }))
                    : (facets[key] ?? []).map((o) => ({
                        value: o.value,
                        label: `${o.value} (${o.count})`,
                      }))),
                ]}
                onchange={(v) => setExtra(key, String(v))}
              />
            {/if}
            <Button
              variant="ghost"
              size="sm"
              square
              icon="cancel"
              title="remove the {def.label} filter"
              aria-label="remove the {def.label} filter"
              onclick={() => removeFilter(key)}
            />
          </span>
        {/if}
      {/each}

      <FilterMenu {shown} {facets} onadd={addFilter} />
    {/if}

    {#if activeFilters}
      <Button
        variant="ghost"
        size="sm"
        square
        tone="danger"
        icon="erase"
        title="clear filters"
        aria-label="clear filters"
        onclick={clearFilters}
      />
    {/if}
  </div>

  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if slow}
    <Spinner
      label={mode === "search" ? "searching the archive" : "loading the library"}
    />
  {/if}

  <!-- Never a "0 items" line above an empty state — the empty state says it. -->
  {#if items.length}
    <p class="tally">{items.length} {mode === "search" ? "matches" : "items"}</p>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul
    class="results"
    class:empty-list={!loading && !error && items.length === 0}
    onmousemove={() => (pointerMoved = true)}
  >
    {#each items as it, i (it.kind + it.id)}
      <li>
        <button
          class="row {it.kind}"
          class:cursor={i === cursor}
          bind:this={rowEls[i]}
          onclick={() => openItem(it)}
          onfocus={() => (cursor = i)}
          onmouseenter={() => pointerMoved && (cursor = i)}
        >
          {#if it.relevance != null}
            <span
              class="gauge {it.grade ?? 'weak'}"
              role="meter"
              aria-valuenow={Math.round(it.relevance * 100)}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="match"
              title="{it.grade ?? 'weak'} match, {Math.round(
                it.relevance * 100,
              )}%"
            >
              <span
                class="fill"
                use:growBar={{
                  pct: fill(it.relevance),
                  delay: Math.min(i * 0.06, 0.6),
                }}
              ></span>
            </span>
          {/if}

          <span class="body">
            <span class="line">
              <span class="title">{it.title}</span>
              <span class="tr">
                {#if it.version}<span class="ver">{it.version}</span>{/if}
              </span>
            </span>
            {#if it.snippet}
              <span class="snippet"
                >{#each it.snippet as s}{#if s.hit}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}</span
              >
            {/if}
            <span class="foot">
              <span class="tags">
                {#if it.customer}
                  <Chip
                    tone="accent"
                    title="specific to this customer's install, not general product behaviour"
                    >{it.customer}</Chip
                  >
                {/if}
                {#each it.tags as tag}<Chip>{tag}</Chip>{/each}
              </span>
              <span class="state {it.status}">{it.status}</span>
              <span class="stamp">
                {#if it.updated}<span>updated {it.updated}</span>{/if}
              </span>
            </span>
          </span>
        </button>
      </li>
    {/each}

    {#if !loading && !error && items.length === 0}
      <li>
        <EmptyState
          icon={kind === "docs" ? "doc" : "library"}
          title={mode === "search"
            ? `No matches for “${q}”.`
            : "The library is empty."}
          detail={mode === "search"
            ? "Search covers summaries, symptoms, signals (error codes), root causes, tags and doc bodies."
            : "Analyze a ticket in chat, or add an entry by hand."}
        />
      </li>
    {/if}
  </ul>
{/if}

<style>
  .toggle {
    display: inline-flex;
    gap: var(--pad-1);
  }
  .head {
    margin-bottom: var(--pad-3);
  }

  /* Pinned: the filters and the result list scroll under it, so the query that
     produced them is never off screen. It needs a ground of its own — the rows
     it pins over are opaque cards, and without one they read through it. */
  .bar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    gap: var(--pad-2);
    align-items: center;
    background: var(--panel-bg);
    padding-block: var(--pad-2);
  }
  /* A sticky box cannot rise above its containing block, and `main`'s content
     box starts one --main-air below the scrollport. So the bar pins that far
     down and rows scroll up through the strip above it. It carries its own
     ground up over that strip; `main`'s overflow clips whatever overshoots. */
  .bar::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: var(--main-air, 0.65rem);
    background: var(--panel-bg);
  }
  .search {
    flex: 1;
    min-width: 12rem;
  }

  /* Sits well clear of the search bar and centred, so the controls read as a
     row of their own rather than a second line of the input. */
  .filters {
    display: flex;
    gap: var(--pad-2);
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: var(--pad-4);
    margin-bottom: var(--pad-3);
  }

  /* An added filter travels with its own remove button, so the pair must wrap
     as one unit however wide the row gets. */
  .extra {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
  }

  .tally {
    margin: var(--pad-1) 0;
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  .results {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }

  /* Centers the empty-state card in the leftover viewport height instead of
     it sitting flush under the filters bar. */
  .results.empty-list {
    flex: 1;
    min-height: 0;
    justify-content: center;
  }

  /* One kind color per card, worn by the left bar and the match gauge, which
     spans the card so it can run its full height. */
  .row {
    width: 100%;
    text-align: left;
    display: flex;
    align-items: stretch;
    gap: var(--pad-3);
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: var(--panel);
    border: 1px solid transparent;
    border-left: 3px solid var(--kind);
    border-radius: var(--radius);
    padding: var(--pad-3);
  }
  .row.entry {
    --kind: var(--accent);
  }
  .row.doc {
    --kind: var(--doc);
  }
  /* An article is curated rather than imported, so it reads as its own shelf. */
  .row.article {
    --kind: var(--ok, var(--accent));
  }
  /* Only `.cursor` paints — hovering MOVES the cursor rather than lighting a
     second card, so there is exactly one highlight and the pointer and the
     keyboard share one position. */
  .row.cursor,
  .row:focus-visible {
    outline: none;
    border-color: var(--accent);
    border-left-color: var(--kind);
    background: var(--accent-dim);
  }

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
  }
  .line {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: start;
    gap: var(--pad-3);
  }

  /* The track runs the full height of the card, so a card with a preview
     simply gets a longer bar. The tiers stay at fixed PERCENTAGES — that is
     the shared reference — and are cut out in the page color so they read as
     notches through the fill. */
  .gauge {
    position: relative;
    flex: none;
    min-height: 1.4rem;
    width: 5px;
    background: color-mix(in srgb, var(--muted) 26%, transparent);
    border-radius: 2px;
    overflow: hidden;
  }
  .gauge::before,
  .gauge::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    z-index: 1;
    background: var(--gauge-tick);
  }
  .gauge::before {
    bottom: 35%;
  }
  .gauge::after {
    bottom: 70%;
  }
  .fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 0;
    border-radius: 2px;
    background: var(--muted);
  }
  .gauge.good .fill {
    background: var(--accent);
  }
  .gauge.strong .fill {
    background: var(--ok);
  }
  .title {
    font-weight: 500;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .tr {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-xs);
    color: var(--muted);
    white-space: nowrap;
  }
  .ver {
    color: var(--kind);
  }

  .snippet {
    color: var(--muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .snippet mark {
    background: var(--accent-dim);
    color: var(--text);
  }

  /* Equal side tracks keep the status centred on the card, not between
     whatever the tags and the date happen to weigh. */
  .foot {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: baseline;
    gap: var(--pad-3);
    margin-top: auto;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .tags {
    display: flex;
    align-items: baseline;
    gap: var(--pad-1);
    flex-wrap: wrap;
    min-width: 0;
  }
  .stamp {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    justify-self: end;
    white-space: nowrap;
  }

  /* Status reads at a glance but never competes with the title: each tone is
     mixed halfway into --muted. */
  .state {
    letter-spacing: var(--label-spacing);
    white-space: nowrap;
    color: var(--muted);
  }
  .state.approved {
    color: color-mix(in srgb, var(--ok) 55%, var(--muted));
  }
  .state.draft {
    color: color-mix(in srgb, var(--accent) 55%, var(--muted));
  }
  .state.deprecated {
    color: color-mix(in srgb, var(--warn) 55%, var(--muted));
  }
  .state.rejected {
    color: color-mix(in srgb, var(--danger) 55%, var(--muted));
  }
  .state.archived {
    color: var(--muted);
    opacity: 0.75;
  }

</style>
