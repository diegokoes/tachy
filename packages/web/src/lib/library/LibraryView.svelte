<script lang="ts">
  import { fmtDate } from "../dates";
  import { createSequence } from "../resource.svelte";
  import { KNOWLEDGE_STATUSES, REFERENCE_STATUSES } from "../vocab";
  import { MAX_PAGE } from "@tachy/contract";
  import { onMount } from "svelte";
  import { api } from "../api";
  import type { KnowledgeRow, ReferenceRow } from "../types";
  import type { ComponentRow, ProductRow } from "@tachy/contract";
  import { navigate, segment, segments } from "../router.svelte";
  import { setSubnav, type SubnavItem } from "../subnav.svelte";
  import { pushScope } from "../keys.svelte";
  import { vimState } from "../vim.svelte";
  import { excerpt, type Seg } from "./matching";
  import ResultRow from "./ResultRow.svelte";
  import { fill, toDoc, toEntry, type Item } from "./items";
  import { isCurator } from "../session.svelte";
  import { t } from "../terms";
  import { errText } from "../resource.svelte";
  import { componentOptions } from "../catalog";
  import { Button, EmptyState, Note, Select, Spinner } from "../tui";
  import FilterMenu from "./FilterMenu.svelte";
  import TagFilter from "./TagFilter.svelte";
  import {
    applyExtras,
    byKey,
    clearScoped,
    loadFilters,
    pruneValues,
    saveFilters,
    takePreset,
    type FacetKey,
    type Facets,
    type ScopePreset,
  } from "./filters";
  import EntryDetail from "../EntryDetail.svelte";
  import DocDetail from "./DocDetail.svelte";
  import { movedWikiPath, ORG_WIDE, wikiPath } from "../wiki/paths";
  import EntryForm from "../knowledge/EntryForm.svelte";
  import ReferenceForm from "../reference/ReferenceForm.svelte";

  // The section's places, rendered as the subnav across the window's top edge.
  // Keys are URL segments and labels are not: the segment stays 'entries' so
  // existing links keep resolving, while the tab reads 'knowledge'.
  //
  // 'all' is the landing on purpose. Entries and docs are one corpus that
  // search spans; splitting them is an optional narrowing, never a gate you
  // have to pass to see anything.
  const KINDS: SubnavItem[] = [
    { key: "all", label: "all" },
    { key: "entries", label: "knowledge", icon: "cap" },
    { key: "docs", label: "docs", icon: "clipboard" },
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

  // The wiki has its own section now; an old /library/wiki link follows it.
  $effect(() => {
    if (kind === "wiki") navigate(movedWikiPath(segments()), { replace: true });
  });

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

  let products = $state<ProductRow[]>([]);
  let components = $state<ComponentRow[]>([]);

  /** Counts for every facet under whatever else is currently selected. */
  let facets = $state<Facets>({});
  /** Which extra filters the user added, and to what — persisted per browser. */
  let shown = $state<FacetKey[]>([]);
  let extras = $state<Record<string, string>>({});
  const versions = $derived(facets.affected_version ?? []);

  let items = $state<Item[]>([]);
  /**
   * A leg came back full, so the server had more it would not send. There is no
   * cursor to follow it with yet — what this buys is the tally saying "first",
   * instead of counting a truncated list as though it were the whole answer.
   */
  let capped = $state(false);
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
    p.set("limit", String(MAX_PAGE));
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
      capped = ents.length >= MAX_PAGE || docs.length >= MAX_PAGE;

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
      products = await api.get<ProductRow[]>("/products");
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
  const currentFacets = createSequence();

  async function loadFacets() {
    // Its own sequence, separate from `run`'s: two quick filter changes fire
    // two loads, and the slower must not overwrite the newer options with
    // values that have no rows.
    const isCurrent = currentFacets();
    const p = new URLSearchParams();
    if (productId) p.set("product_id", productId);
    if (productId && component) p.set("component", component);
    if (status) p.set("status", status);
    if (version) p.set("affected_version", version);
    applyExtras(p, shown, extras);
    try {
      const next = await api.get<Facets>(`/knowledge/facets?${p}`);
      if (!isCurrent()) return;
      facets = next;
    } catch {
      if (!isCurrent()) return;
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
    void loadFacets();
  }

  function setExtra(key: FacetKey, value: string) {
    extras = { ...extras, [key]: value };
    persist();
  }

  const persist = () => saveFilters({ shown, values: extras });

  const currentComponents = createSequence();

  /**
   * product › component › version. A version names a release of one component,
   * so once there is no component under it there is nothing for the number to
   * mean — carrying it over would narrow the list by a build from elsewhere.
   */
  function dropComponentScoped() {
    version = "";
    extras = clearScoped(extras);
    persist();
  }

  async function onProductChange(id: string) {
    const isCurrent = currentComponents();
    component = "";
    components = [];
    dropComponentScoped();
    const slug = products.find((p) => p.id === id)?.slug;
    if (slug)
      try {
        const next = await api.get<ComponentRow[]>(`/products/${slug}/components`);
        if (!isCurrent()) return;
        components = next;
      } catch {
        if (!isCurrent()) return;
        components = [];
      }
    await loadFacets();
  }

  /**
   * A control never reads narrower than the cap naming it — the caps are what
   * the row is scanned by. Measured rather than guessed at in `ch`: the cap is
   * a different size and tracking from the control under it.
   */
  function capFloor(node: HTMLElement) {
    const cap = node.querySelector<HTMLElement>(".cap");
    if (!cap) return;
    const apply = () => {
      node.style.minWidth = `${Math.ceil(cap.offsetWidth * 1.25)}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(cap);
    return { destroy: () => ro.disconnect() };
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
        products.find((p) => p.id === i.productId)?.slug ?? ORG_WIDE;
      navigate(wikiPath(scope, i.slug));
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

  /** Opens narrowed to what another page asked for; see `presetScope`. */
  async function applyPreset(p: ScopePreset) {
    const id = products.find((x) => x.slug === p.product)?.id as
      | string
      | undefined;
    if (!id) return;
    productId = id;
    await onProductChange(id);
    if (p.component && components.some((c) => c.slug === p.component)) {
      component = p.component;
      await loadFacets();
    }
  }

  onMount(() => {
    const stored = loadFilters();
    shown = stored.shown;
    extras = stored.values;
    const scoped = takePreset();
    void loadCatalog().then(() => scoped && applyPreset(scoped));
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
  <!-- Redirecting to /wiki; see the effect above. -->
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
    <!-- Both act on the row below rather than being filters themselves, so
         they follow the search box instead of joining that row. -->
    <span class="tools">
      {#if showEntryFilters}
        <FilterMenu
          {shown}
          {facets}
          {component}
          onadd={addFilter}
          onremove={removeFilter}
        />
      {/if}
      {#if activeFilters}
        <Button
          variant="ghost"
          tone="danger"
          icon="discard"
          title="reset every filter"
          onclick={clearFilters}
        >
          <span class="lbl">reset filters</span>
        </Button>
      {/if}
    </span>
  </div>

  <!-- The default row stays deliberately short. Everything else the schema can
       be narrowed by — environment, confidence, clarity, pattern, hidden fix,
       fixed version, tags — is one `+` away and remembered per browser. -->
  <div class="controls">
    <div class="filters">
      <!-- product and component scope entries AND docs, so they stay visible in
           every mode; version and value exist only on entries. -->
      <span class="field" use:capFloor>
        <span class="cap">{t("product")}</span>
        <Select
          bind:value={productId}
          active={!!productId}
          keepOpen
          title={t("product")}
          options={[
            { value: "", label: "any" },
            ...products.map((p) => ({ value: p.id, label: p.name })),
          ]}
          onchange={(v) => onProductChange(String(v))}
        />
      </span>
      <span class="field" use:capFloor>
        <span class="cap">component</span>
        <Select
          bind:value={component}
          active={!!component}
          keepOpen
          title={`Component (within the chosen ${t("product")})`}
          disabled={!productId || components.length === 0}
          options={[{ value: "", label: "any" }, ...componentOptions(components)]}
          onchange={(v) => {
            if (!v) dropComponentScoped();
            void loadFacets();
          }}
        />
      </span>

      {#if showEntryFilters}
        <span class="field" use:capFloor>
          <span class="cap">version</span>
          <Select
            bind:value={version}
            active={!!version}
            keepOpen
            title="Affected version (within the chosen component)"
            disabled={!component || versions.length === 0}
            options={[
              { value: "", label: "any" },
              ...versions.map((v) => ({
                value: v.value,
                label: `${v.value} (${v.count})`,
              })),
            ]}
          />
        </span>
      {/if}

      <span class="field" use:capFloor>
        <span class="cap">status</span>
        <Select
          bind:value={status}
          active={!!status}
          keepOpen
          title="Status"
          options={[
            { value: "", label: "any" },
            ...(showDocFilters ? DOC_STATUSES : STATUSES),
          ]}
        />
      </span>

      {#if showEntryFilters}
        {#each shown as key (key)}
          {@const def = byKey(key)}
          {#if def}
            <span class="extra">
              <span class="field" use:capFloor>
                <span class="cap">{def.label}</span>
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
                    keepOpen
                    title={def.needsComponent
                      ? `${def.label} (within the chosen component)`
                      : def.label}
                    disabled={def.needsComponent && !component}
                    options={[
                      { value: "", label: "any" },
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
              </span>
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
      {/if}
    </div>

    <!-- Never a "0 items" line above an empty state — the empty state says it.
         It rides in the left margin the centred filter row leaves empty, so it
         costs the list no height of its own. -->
    {#if items.length}
      <p class="tally">
        {#if capped}first{/if}
        <span class="count">{items.length.toLocaleString()}</span>
        {mode === "search" ? "matches" : "items"}
      </p>
    {/if}
  </div>

  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if slow}
    <Spinner
      label={mode === "search" ? "searching the archive" : "loading the library"}
    />
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul
    class="results"
    class:empty-list={!loading && !error && items.length === 0}
    onmousemove={() => (pointerMoved = true)}
  >
    {#each items as it, i (it.kind + it.id)}
      <li>
        <ResultRow
          item={it}
          selected={i === cursor}
          delay={Math.min(i * 0.06, 0.6)}
          bind:el={rowEls[i]}
          onopen={() => openItem(it)}
          onfocus={() => (cursor = i)}
          onhover={() => pointerMoved && (cursor = i)}
        />
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
            ? "Searches summaries, symptoms, signals, root causes, tags, doc bodies."
            : "Analyze a ticket in chat, or add an entry."}
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
    flex: 0 1 75%;
    min-width: 12rem;
  }
  .tools {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
  }
  /* Cased in CSS, not in the copy — a screen reader still hears a word. */
  .lbl {
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }

  /* The caps occupy the space between the search bar and the controls. The
     top margin subtracts a cap and its gap, so the controls keep their
     offset. */
  .controls {
    position: relative;
    margin-top: calc(var(--pad-4) - var(--fs-xs) - var(--pad-1));
    margin-bottom: var(--pad-2);
  }

  /* Centred, so the controls read as a row of their own rather than a second
     line of the input. Bottom-aligned: a cap is one line, a tag box is not. */
  .filters {
    display: flex;
    gap: var(--pad-2);
    align-items: end;
    justify-content: center;
    flex-wrap: wrap;
  }

  .field {
    display: inline-flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  /* Its own width, not the column's, so `capFloor` can measure the text and
     the auto margins can centre it over the control. */
  .cap {
    width: max-content;
    max-width: 100%;
    margin-inline: auto;
    font-size: var(--fs-xs);
    line-height: 1;
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    text-align: center;
    color: var(--muted);
  }

  /* An added filter travels with its own remove button, so the pair must wrap
     as one unit however wide the row gets. The button hangs off the side of the
     column rather than sitting in it, so the cap still centres on the control
     and the control alone answers to the cap's width floor. */
  .extra {
    display: inline-flex;
    align-items: end;
    gap: var(--pad-1);
  }

  .tally {
    position: absolute;
    left: 0;
    bottom: 0;
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--muted);
    pointer-events: none;
  }
  /* Tabular figures and a fixed slot: the count runs through every digit on
     its way to the total, and proportional ones make the words either side of
     it jitter for the whole tween. */
  .count {
    display: inline-block;
    min-width: 3ch;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--text);
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


</style>
