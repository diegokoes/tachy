<script lang="ts">
  import { api, ApiError } from "./api";
  import type { ReferenceRow, ReferenceLineageRow, NamedRow } from "./types";
  import Facets from "./Facets.svelte";
  import AsciiSpinner from "./AsciiSpinner.svelte";
  import AsciiSelect from "./AsciiSelect.svelte";
  import ReferenceForm from "./reference/ReferenceForm.svelte";
  import { isCurator, canCurateScope } from "./session.svelte";

  let q = $state("");
  let status = $state("");
  let rows = $state<ReferenceRow[]>([]);
  let selected = $state<ReferenceRow | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let mode = $state<"search" | "browse">("browse");

  
  let creating = $state(false);
  let editing = $state(false);
  let newVersion = $state(false);
  let lineage = $state<ReferenceLineageRow[]>([]);
  let mutating = $state(false);
  let mutateError = $state<string | null>(null);
  let conflict = $state(false);
  let productTeamSlug = $state<string | null>(null);

  const canEdit = $derived(
    !!selected && canCurateScope({ team_id: selected.team_id, team_slug: productTeamSlug }),
  );

  
  const MIN_SPIN_MS = 450;
  let seq = 0;

  async function run() {
    const mySeq = ++seq;
    const started = Date.now();
    loading = true;
    error = null;
    try {
      mode = q.trim() ? "search" : "browse";
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status && mode === "browse") p.set("status", status);
      const path = mode === "search" ? `/reference/search?${p}` : `/reference?${p}`;
      let result = await api.get<ReferenceRow[]>(path);
      if (mode === "search" && status) result = result.filter((r) => r.status === status);
      if (mySeq !== seq) return;
      rows = result;
    } catch (e) {
      if (mySeq === seq) error = e instanceof Error ? e.message : String(e);
    } finally {
      const left = MIN_SPIN_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      if (mySeq === seq) loading = false;
    }
  }

  async function open(id: string) {
    error = null;
    editing = false;
    newVersion = false;
    mutateError = null;
    conflict = false;
    productTeamSlug = null;
    try {
      selected = await api.get<ReferenceRow>(`/reference/${id}`);
      try {
        lineage = await api.get<ReferenceLineageRow[]>(`/reference/${id}/lineage`);
      } catch {
        lineage = [];
      }
      if (isCurator() && selected.product_id && !selected.team_id) {
        const products = await api.get<NamedRow[]>("/products");
        productTeamSlug = (products.find((p) => p.id === selected!.product_id)?.team_slug as string) ?? null;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const versionLabel = (l: ReferenceLineageRow) =>
    `${l.doc_version ? `v${l.doc_version}` : fmtDate(l.created_at) || l.id.slice(0, 8)} · ${l.status}`;

  async function patch(body: Record<string, unknown>) {
    if (!selected) return;
    mutating = true;
    mutateError = null;
    conflict = false;
    try {
      await api.patch(`/reference/${selected.id}`, { ...body, expectedVersion: selected.version });
      editing = false;
      await open(selected.id);
      run();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        conflict = true;
        mutateError = "someone else edited this doc in the meantime - reload to get the latest version";
      } else {
        mutateError = e instanceof Error ? e.message : String(e);
      }
    } finally {
      mutating = false;
    }
  }

  let createSaving = $state(false);
  let createError = $state<string | null>(null);
  async function createDoc(payload: Record<string, unknown>) {
    createSaving = true;
    createError = null;
    try {
      const created = await api.post<{ id: string }>("/reference", payload);
      creating = false;
      newVersion = false;
      await open(created.id);
      run();
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      createSaving = false;
    }
  }

  const fmtDate = (d?: string) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  
  
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ranOnce = false;
  $effect(() => {
    void q; void status;
    clearTimeout(timer);
    timer = setTimeout(run, ranOnce ? 250 : 0);
    ranOnce = true;
    return () => clearTimeout(timer);
  });
</script>

{#if selected}
  <button class="close" onclick={() => (selected = null)}>← back</button>
  {#if editing}
    <h2>edit doc</h2>
    {#if conflict}
      <p class="error">{mutateError} <button class="mini" onclick={() => open(selected!.id)}>reload</button></p>
    {/if}
    <ReferenceForm
      mode="edit"
      initial={selected}
      saving={mutating}
      error={conflict ? null : mutateError}
      onSubmit={patch}
      onCancel={() => { editing = false; mutateError = null; }}
    />
  {:else if newVersion}
    <h2>new version of “{selected.title}”</h2>
    <ReferenceForm
      mode="create"
      initial={{ title: selected.title, tags: selected.tags, body: selected.body, status: "approved" }}
      supersedes={selected.id}
      saving={createSaving}
      error={createError}
      onSubmit={createDoc}
      onCancel={() => { newVersion = false; createError = null; }}
    />
  {:else}
    <h2>{selected.title}</h2>
    <div class="doc-meta">
      {#if selected.status !== "approved"}<span class="badge {selected.status}">{selected.status}</span>{/if}
      {#if selected.doc_version}<span class="badge">v{selected.doc_version}</span>{/if}
      {#if selected.source}<span class="muted">source: {selected.source}</span>{/if}
      {#if selected.updated_at}<span class="muted">updated {fmtDate(selected.updated_at)}</span>{/if}
      {#if lineage.length > 1}
        <AsciiSelect
          value={selected.id}
          title="All versions of this doc"
          options={lineage.map((l) => ({ value: l.id, label: versionLabel(l) }))}
          onchange={(v) => open(String(v))}
        />
      {/if}
    </div>
    {#if canEdit}
      <div class="curation">
        <button class="mini" onclick={() => { editing = true; mutateError = null; }}>edit</button>
        {#if selected.status === "approved"}
          <button class="mini" onclick={() => { newVersion = true; createError = null; }}>new version…</button>
        {/if}
        {#if selected.status === "draft"}
          <button class="mini" onclick={() => patch({ status: "approved" })} disabled={mutating}>approve</button>
        {/if}
        {#if selected.status === "approved"}
          <button class="mini" onclick={() => patch({ status: "draft" })} disabled={mutating}>back to draft</button>
        {/if}
        {#if selected.status !== "archived"}
          <button class="mini warn-btn" onclick={() => patch({ status: "archived" })} disabled={mutating}>archive</button>
        {:else}
          <button class="mini" onclick={() => patch({ status: "draft" })} disabled={mutating}>restore as draft</button>
        {/if}
      </div>
      {#if mutateError}
        <p class="error">{mutateError} {#if conflict}<button class="mini" onclick={() => open(selected!.id)}>reload</button>{/if}</p>
      {/if}
    {/if}
    <Facets label="Tags" items={selected.tags} />
    <pre class="body">{selected.body ?? "(no body)"}</pre>
  {/if}
{:else if creating}
  <button class="close" onclick={() => (creating = false)}>← back</button>
  <h2>new reference doc</h2>
  <p class="intro muted prose-measure">Freeform project context (runbook, architecture note, process doc). Approved docs are chunked, embedded, and surface in the agent's consult search.</p>
  <ReferenceForm
    mode="create"
    saving={createSaving}
    error={createError}
    onSubmit={createDoc}
    onCancel={() => (creating = false)}
  />
{:else}

  <div class="controls-primary">
    <input
      class="search"
      placeholder="Search docs by topic, service, procedure…"
      bind:value={q}
      onkeydown={(e) => { if (e.key === "Enter") { clearTimeout(timer); run(); } }}
    />
    {#if isCurator()}
      <button class="new" onclick={() => (creating = true)}>+ new doc</button>
    {/if}
  </div>
  <div class="controls-filters">
    <span class="filters-label">filter:</span>
    <AsciiSelect bind:value={status} title="Doc status"
      options={[{ value: "", label: "any status" }, "draft", "approved", "archived"]} />
    {#if status}
      <span class="filters-count">1 active</span>
      <button class="mini" onclick={() => (status = "")}>clear</button>
    {/if}
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  {#if loading}<AsciiSpinner label="searching the docs" />{/if}
  <ul class="results">
    {#each rows as r (r.id)}
      <li>
        <button class="row" onclick={() => open(r.id)}>
          <span class="title">
            {#if r.status && r.status !== "approved"}<span class="badge {r.status}">{r.status}</span>{/if}
            {r.title}
          </span>
          {#if r.snippet}<span class="snippet">{r.snippet}</span>{/if}
          <span class="meta">
            {#if r.doc_version}<span class="date">v{r.doc_version}</span>{/if}
            {#if r.tags?.length}
              {#each r.tags.slice(0, 6) as t}<span class="tag">{t}</span>{/each}
            {/if}
            {#if r.source}<span class="date">from {r.source}</span>{/if}
            {#if r.updated_at}<span class="date">updated {fmtDate(r.updated_at)}</span>{/if}
          </span>
        </button>
      </li>
    {/each}
    {#if !loading && !error && rows.length === 0}
      <li class="empty">
        {#if mode === "search"}
          <p>No docs match “{q}”.</p>
        {:else}
          <p>No reference docs yet.</p>
          <p class="muted">
            Feed project context through the <strong>Chat</strong> tab - paste a wiki page,
            attach a file, or point the agent at a URL ("here's our deployment runbook…").
            It proposes structured docs for your approval and saves them here.
            {#if isCurator()}Or write one by hand with <strong>+ new doc</strong>.{/if}
          </p>
        {/if}
      </li>
    {/if}
  </ul>
{/if}

<style>
  .intro { margin: 0 0 0.9rem; font-size: 0.88rem; line-height: 1.55; }
  .title { font-weight: 500; }
  .snippet { color: var(--muted); font-size: 0.82rem; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .date { color: var(--muted); font-size: 0.75rem; margin-left: 0.3rem; }
  .badge {
    display: inline-block;
    font-size: 0.72rem;
    padding: 0.05rem 0.45rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    color: var(--muted);
    margin-right: 0.35rem;
  }
  .badge.draft { border-color: var(--accent); color: var(--accent); }
  .badge.archived { opacity: 0.8; }
  .doc-meta { display: flex; gap: 0.75rem; align-items: baseline; margin-bottom: 0.4rem; font-size: 0.82rem; }
  .curation { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
  .mini { font-size: 0.78rem; padding: 0.15rem 0.5rem; }
  .warn-btn { border-color: var(--warn); color: var(--warn); }
  .body { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem; white-space: pre-wrap; line-height: 1.55; overflow-x: auto; }
  .close { margin-bottom: 0.5rem; }
  h2 { font-size: 1.2rem; margin: 0.25rem 0 0.4rem; }
</style>
