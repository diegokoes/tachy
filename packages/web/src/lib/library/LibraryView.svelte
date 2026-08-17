<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import type { KnowledgeRow, NamedRow, ReferenceRow } from "../types";
  import { navigate, segment } from "../router.svelte";
  import { pushScope } from "../keys.svelte";
  import { growBar } from "../motion";
  import { entryText, excerpt, type Seg } from "./matching";
  import { isCurator } from "../session.svelte";
  import { t } from "../terms";
  import { errText } from "../resource.svelte";
  import { Button, Chip, EmptyState, Icon, Note, Select, Spinner } from "../tui";
  import EntryDetail from "../EntryDetail.svelte";
  import DocDetail from "./DocDetail.svelte";
  import EntryForm from "../knowledge/EntryForm.svelte";
  import ReferenceForm from "../reference/ReferenceForm.svelte";

  type Item = {
    kind: "entry" | "doc";
    id: string;
    title: string;
    status: string;
    /** Query-centred excerpt of the matching chunk, split on the hits. */
    snippet?: Seg[];
    /** Top-right of the card: doc version, or an entry's version span. */
    version?: string;
    /** Bottom-right, ahead of the date. */
    facts: string[];
    updated?: string;
    tags: string[];
    /** Server-calibrated 0-1 match strength — what the gauge draws. */
    relevance?: number;
    /** "strong" | "good" | "weak", from the same calibration. */
    grade?: string;
    sortAt: number;
  };

  const KINDS = [
    { key: "all", label: "all" },
    { key: "entries", label: "entries" },
    { key: "docs", label: "docs" },
  ];

  const STATUSES = ["draft", "approved", "deprecated", "archived", "rejected"];
  const DOC_STATUSES = ["draft", "approved", "archived"];

  const kind = $derived(segment(1) ?? "all");
  const param = $derived(segment(2));
  const listing = $derived(
    kind === "new" ? false : !param || kind === "all",
  );

  /** The tab a detail view was opened from, so "back" returns there. */
  let origin = $state("all");
  /** Which form the create screen shows — in the URL, so it deep-links. */
  const newKind = $derived(param === "doc" ? "doc" : "entry");

  let q = $state("");
  let status = $state("");
  let learningValue = $state("");
  let productId = $state("");
  let component = $state("");
  let version = $state("");

  let products = $state<NamedRow[]>([]);
  let components = $state<NamedRow[]>([]);
  let versions = $state<{ version: string; count: number }[]>([]);

  let items = $state<Item[]>([]);
  // Starts true so the first paint shows nothing rather than the empty state.
  let loading = $state(true);
  let slow = $state(false);
  let error = $state<string | null>(null);
  let mode = $state<"search" | "browse">("browse");
  let cursor = $state(0);
  let searchEl = $state<HTMLInputElement>();

  let createSaving = $state(false);
  let createError = $state<string | null>(null);

  const showEntryFilters = $derived(kind === "entries");
  const showDocFilters = $derived(kind === "docs");
  /**
   * Counts hidden filters too: version/value are entry-only but still travel on
   * entryQs, so a filter you cannot see must stay clearable — otherwise the
   * list is silently narrowed with no way out.
   */
  const activeFilters = $derived(
    [productId, component, learningValue, version, status].filter(Boolean)
      .length,
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
    if (learningValue) p.set("learning_value", learningValue);
    if (version) p.set("affected_version", version);
    return p.toString();
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
      facts: [],
      updated: fmtDate(r.updated_at ?? r.created_at),
      tags: (r.tags ?? []).slice(0, 5),
      relevance: r.relevance,
      grade: r.grade,
      sortAt: at(r.updated_at ?? r.created_at),
    };
  }

  function toDoc(r: ReferenceRow, query: string): Item {
    return {
      kind: "doc",
      id: r.id,
      title: r.title,
      status: r.status,
      snippet: r.snippet ? excerpt(r.snippet, query) : undefined,
      version: r.doc_version ? `v${r.doc_version}` : undefined,
      facts: r.source ? [`from ${r.source}`] : [],
      updated: fmtDate(r.updated_at ?? r.created_at),
      tags: (r.tags ?? []).slice(0, 6),
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
      cursor = 0;
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

  async function loadFacets() {
    try {
      products = await api.get<NamedRow[]>("/products");
    } catch {
      products = [];
    }
    await loadVersions();
  }

  /**
   * Only the versions actually recorded, narrowed by the chosen product and
   * component — an affected-version filter that offers a value with no rows
   * behind it is worse than no filter.
   */
  async function loadVersions() {
    const p = new URLSearchParams();
    if (productId) p.set("product_id", productId);
    if (productId && component) p.set("component", component);
    try {
      versions = await api.get<{ version: string; count: number }[]>(
        `/knowledge/versions?${p}`,
      );
    } catch {
      versions = [];
    }
    if (version && !versions.some((v) => v.version === version)) version = "";
  }

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
    await loadVersions();
  }

  function clearFilters() {
    productId = "";
    component = "";
    components = [];
    status = "";
    learningValue = "";
    version = "";
    void loadVersions();
  }

  function openItem(i: Item) {
    origin = kind;
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

  onMount(loadFacets);

  let ranOnce = false;
  $effect(() => {
    if (!listing) return;
    void q;
    void kind;
    void status;
    void learningValue;
    void productId;
    void component;
    void version;
    clearTimeout(timer);
    loading = true;
    timer = setTimeout(run, ranOnce ? 250 : 0);
    ranOnce = true;
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!listing) return;
    const n = items.length;
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
        run: () => (cursor = Math.min(n - 1, cursor + 1)),
      },
      {
        key: "k",
        label: "",
        hidden: true,
        run: () => (cursor = Math.max(0, cursor - 1)),
      },
      {
        key: "↓",
        label: "",
        hidden: true,
        run: () => (cursor = Math.min(n - 1, cursor + 1)),
      },
      {
        key: "↑",
        label: "",
        hidden: true,
        run: () => (cursor = Math.max(0, cursor - 1)),
      },
      {
        key: "⏎",
        label: "",
        hidden: true,
        run: () => items[cursor] && openItem(items[cursor]),
      },
    ]);
  });
</script>

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

{#if kind === "entries" && param}
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
      placeholder="Search symptoms, error codes, root causes, docs…  (ctrl+k)"
      bind:value={q}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          clearTimeout(timer);
          run();
        }
      }}
    />
    {#if isCurator()}
      <Button
        variant="primary"
        square
        tone="ok"
        icon="plus"
        title="new entry or doc"
        aria-label="new entry or doc"
        onclick={() => navigate("/library/new/entry")}
      />
    {/if}
  </div>

  <!-- No environment control on purpose: cloud is part of the searchable text,
       so "prod printer error" narrows by environment from the search bar. -->
  <div class="filters">
    <Select
      value={kind}
      title="entries, docs, or both"
      options={KINDS.map((k) => ({ value: k.key, label: k.label }))}
      onchange={(v) => navigate(v === "all" ? "/library" : `/library/${v}`)}
    />

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
        ...components.map((c) => c.slug as string),
      ]}
      onchange={() => loadVersions()}
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
            value: v.version,
            label: `${v.version} (${v.count})`,
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
      <Select
        bind:value={learningValue}
        active={!!learningValue}
        title="Learning value"
        options={[{ value: "", label: "any value" }, "high", "medium", "low"]}
      />
    {/if}

    {#if activeFilters}
      <Button
        variant="ghost"
        size="sm"
        square
        icon="cancel"
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

  <ul class="results" class:empty-list={!loading && !error && items.length === 0}>
    {#each items as it, i (it.kind + it.id)}
      <li>
        <button
          class="row {it.kind}"
          class:cursor={i === cursor}
          onclick={() => openItem(it)}
          onfocus={() => (cursor = i)}
        >
          <span class="mark">
            <Icon
              name={it.kind === "entry" ? "analyze" : "doc"}
              size="1em"
              weight={7}
              label={it.kind === "entry" ? "knowledge entry" : "reference doc"}
            />
            {#if it.relevance != null}
              <span
                class="gauge {it.grade ?? 'weak'}"
                role="meter"
                aria-valuenow={Math.round(it.relevance * 100)}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="match"
                title="{it.grade ?? 'weak'} match — {Math.round(
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
          </span>

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
                {#each it.tags as tag}<Chip>{tag}</Chip>{/each}
              </span>
              <span class="state {it.status}">{it.status}</span>
              <span class="stamp">
                {#each it.facts as f}<span>{f}</span>{/each}
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

  .bar {
    display: flex;
    gap: var(--pad-2);
    align-items: center;
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

  /* One kind color per card, worn by the left bar and the row's mark. The
     mark column spans the card, so the gauge can run its full height. */
  .row {
    width: 100%;
    text-align: left;
    display: grid;
    grid-template-columns: auto 1fr;
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
  .row:hover,
  .row.cursor,
  .row:focus-visible {
    outline: none;
    border-color: var(--accent);
    border-left-color: var(--kind);
    background: var(--accent-dim);
  }

  /* Fixed mark column, so every title starts at the same x whatever the
     card carries on its right. */
  .mark {
    color: var(--kind);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-2);
    padding-top: 0.2em;
    width: 1em;
  }
  .body {
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

  /* The track runs from under the mark to the foot of the card, so a card with
     a preview simply gets a longer bar. The tiers stay at fixed PERCENTAGES —
     that is the shared reference — and are cut out in the page color so they
     read as notches through the fill. */
  .gauge {
    position: relative;
    flex: 1;
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
