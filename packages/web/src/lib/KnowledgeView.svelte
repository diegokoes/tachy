<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./api";
  import type { KnowledgeRow, NamedRow } from "./types";
  import EntryDetail from "./EntryDetail.svelte";
  import EntryForm from "./knowledge/EntryForm.svelte";
  import AsciiSpinner from "./AsciiSpinner.svelte";
  import AsciiSelect from "./AsciiSelect.svelte";
  import { isCurator } from "./session.svelte";
  import { t } from "./terms";

  let q = $state("");
  let cloud = $state("");
  let status = $state("");
  let learningValue = $state("");
  let productId = $state("");
  let component = $state("");
  let version = $state("");
  let environments = $state<{ cloud: string; count: number }[]>([]);
  let products = $state<NamedRow[]>([]);
  let components = $state<NamedRow[]>([]);
  let rows = $state<KnowledgeRow[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selected = $state<string | null>(null);
  let creating = $state(false);
  let createSaving = $state(false);
  let createError = $state<string | null>(null);
  let mode = $state<"search" | "browse">("browse");

  const STATUSES = ["draft", "approved", "deprecated", "archived", "rejected"];

  function qs() {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (cloud) p.set("cloud", cloud);
    if (learningValue) p.set("learning_value", learningValue);
    if (productId) p.set("product_id", productId);
    if (productId && component) p.set("component", component);
    if (version.trim()) p.set("affected_version", version.trim());
    // /search has a fixed approved+deprecated scope; status only applies to list.
    if (status && !q.trim()) p.set("status", status);
    return p.toString();
  }

  // Spinner stays up at least this long so fast queries don't blink it.
  const MIN_SPIN_MS = 450;
  let seq = 0;

  async function run() {
    const mySeq = ++seq;
    const started = Date.now();
    loading = true;
    error = null;
    try {
      // /search needs a query; empty query → browse the latest via list.
      mode = q.trim() ? "search" : "browse";
      const path = mode === "search" ? `/knowledge/search?${qs()}` : `/knowledge?${qs()}`;
      let result = await api.get<KnowledgeRow[]>(path);
      if (mode === "search" && status) result = result.filter((r) => r.status === status);
      if (mySeq !== seq) return; // superseded by a newer query
      rows = result;
    } catch (e) {
      if (mySeq === seq) error = e instanceof Error ? e.message : String(e);
    } finally {
      const left = MIN_SPIN_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      if (mySeq === seq) loading = false;
    }
  }

  async function loadEnvironments() {
    try {
      environments = await api.get<{ cloud: string; count: number }[]>("/knowledge/environments");
    } catch {
      environments = [];
    }
  }

  async function loadProducts() {
    try {
      products = await api.get<NamedRow[]>("/products");
    } catch {
      products = [];
    }
  }

  // the component filter is scoped to the chosen product (slugs resolve per product)
  async function onProductChange(id: string) {
    component = "";
    components = [];
    const slug = products.find((p) => p.id === id)?.slug;
    if (!slug) return;
    try {
      components = await api.get<NamedRow[]>(`/products/${slug}/components`);
    } catch {
      components = [];
    }
  }

  async function createEntry(payload: Record<string, unknown>) {
    createSaving = true;
    createError = null;
    try {
      const created = await api.post<{ id: string }>("/knowledge", payload);
      creating = false;
      selected = created.id;
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      createSaving = false;
    }
  }

  onMount(() => {
    loadEnvironments();
    loadProducts();
  });

  // Live search, debounced; Enter skips the debounce. The very first run (on
  // mount) fires immediately  the spinner is already up, don't sit on it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ranOnce = false;
  $effect(() => {
    void q; void cloud; void status; void learningValue; void productId; void component; void version;
    clearTimeout(timer);
    timer = setTimeout(run, ranOnce ? 250 : 0);
    ranOnce = true;
    return () => clearTimeout(timer);
  });
</script>

{#if selected}
  <EntryDetail id={selected} onClose={() => { selected = null; loadEnvironments(); }} onOpen={(id) => (selected = id)} />
{:else if creating}
  <div class="create">
    <button class="close" onclick={() => (creating = false)}>← back</button>
    <h2>new knowledge entry</h2>
    <p class="muted">Manual knowledge (no ticket). Scope it with a {t("product")} so component and search filters work.</p>
    <EntryForm
      mode="create"
      saving={createSaving}
      error={createError}
      onSubmit={createEntry}
      onCancel={() => (creating = false)}
    />
  </div>
{:else}
  <div class="controls">
    <input
      class="search"
      placeholder="Search symptoms, error codes, root cause…"
      bind:value={q}
      onkeydown={(e) => { if (e.key === "Enter") { clearTimeout(timer); run(); } }}
    />
    <AsciiSelect bind:value={productId} title={t("product")}
      options={[{ value: "", label: `any ${t("product")}` }, ...products.map((p) => ({ value: p.id as string, label: p.name as string }))]}
      onchange={(v) => onProductChange(String(v))} />
    <AsciiSelect bind:value={component} title={`Component (within the chosen ${t("product")})`}
      disabled={!productId || components.length === 0}
      options={[{ value: "", label: "any component" }, ...components.map((c) => c.slug as string)]} />
    <AsciiSelect bind:value={cloud} title={`${t("cloud")} observed in`}
      options={[{ value: "", label: `any ${t("cloud")}` }, ...environments.map((e) => ({ value: e.cloud, label: `${e.cloud} (${e.count})` }))]} />
    <AsciiSelect bind:value={status} title="Entry status"
      options={[{ value: "", label: "any status" }, ...STATUSES]} />
    <AsciiSelect bind:value={learningValue} title="Learning value"
      options={[{ value: "", label: "any value" }, "high", "medium", "low"]} />
    <input class="version" placeholder="affected version" bind:value={version} title="Exact affected-version match" />
    {#if isCurator()}
      <button class="new" onclick={() => (creating = true)}>+ new entry</button>
    {/if}
  </div>

  {#if error}<p class="error">{error}</p>{/if}
  {#if loading}<AsciiSpinner label={mode === "search" ? "searching the archive" : "loading entries"} />{/if}

  <p class="muted count">{rows.length} {mode === "search" ? "matches" : "entries"}</p>
  <ul class="results">
    {#each rows as r (r.id)}
      <li>
        <button class="row" onclick={() => (selected = r.id)}>
          <span class="summary">
            {#if r.status && r.status !== "approved"}
              <span class="badge {r.status}">{r.status}</span>
            {/if}
            {r.issue_summary ?? "(no summary)"}
          </span>
          <span class="meta">
            {#if r.product_area}{r.product_area} · {/if}
            {#if r.cloud}{r.cloud} · {/if}
            {#if r.affected_version}v{r.affected_version} · {/if}
            {#if r.confidence}{r.confidence}{/if}
            {#if r.score != null}<span class="score"> · {r.score.toFixed(2)}</span>{/if}
            {#if r.tags?.length}
              <span class="tags">
                {#each r.tags.slice(0, 5) as t}<span class="tag">{t}</span>{/each}
              </span>
            {/if}
          </span>
        </button>
      </li>
    {/each}
    {#if !loading && !error && rows.length === 0}
      <li class="empty">
        {#if mode === "search"}
          <p>No matches for “{q}”.</p>
          <p class="muted">Search covers summaries, symptoms, signals (error codes), root causes and tags.</p>
        {:else}
          <p>The archive is empty.</p>
        {/if}
      </li>
    {/if}
  </ul>
{/if}

<style>
  .controls { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; align-items: center; }
  .search { flex: 1; min-width: 16rem; }
  .version { max-width: 9rem; }
  .new { border-color: var(--accent); color: var(--accent); }
  .create h2 { margin: 0.5rem 0 0.25rem; font-size: 1.15rem; }
  .close { margin-bottom: 0.5rem; }
  .count { margin: 0.25rem 0; font-size: 0.82rem; }
  .results { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .row { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 0.25rem; padding: 0.65rem 0.8rem; background: var(--panel); }
  .summary { font-weight: 500; }
  .meta { color: var(--muted); font-size: 0.8rem; display: flex; align-items: baseline; gap: 0.25rem; flex-wrap: wrap; }
  .score { color: var(--accent); }
  .badge {
    display: inline-block;
    font-size: 0.72rem;
    padding: 0.05rem 0.45rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    color: var(--muted);
    margin-right: 0.35rem;
    vertical-align: middle;
  }
  .badge.deprecated { border-color: var(--warn); color: var(--warn); }
  .badge.draft { border-color: var(--accent); color: var(--accent); }
  .badge.rejected, .badge.archived { opacity: 0.8; }
  .tags { display: inline-flex; gap: 0.3rem; margin-left: 0.3rem; }
  .tag { background: var(--accent-dim); border-radius: 999px; padding: 0 0.5rem; font-size: 0.72rem; color: var(--text); }
  .empty { padding: 1.5rem 0.5rem; }
  .empty p { margin: 0.25rem 0; }
  .muted { color: var(--muted); }
  .error { color: var(--danger); }
</style>
