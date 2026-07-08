<script lang="ts">
  import { api, ApiError } from "./api";
  import type { ReferenceRow, NamedRow } from "./types";
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

  // curation state
  let creating = $state(false);
  let editing = $state(false);
  let mutating = $state(false);
  let mutateError = $state<string | null>(null);
  let conflict = $state(false);
  let productTeamSlug = $state<string | null>(null);

  const canEdit = $derived(
    !!selected && canCurateScope({ team_id: selected.team_id, team_slug: productTeamSlug }),
  );

  // Spinner stays up at least this long so fast queries don't blink it.
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
      const result = await api.get<ReferenceRow[]>(path);
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

  async function open(id: string) {
    error = null;
    editing = false;
    mutateError = null;
    conflict = false;
    productTeamSlug = null;
    try {
      selected = await api.get<ReferenceRow>(`/reference/${id}`);
      if (isCurator() && selected.product_id && !selected.team_id) {
        const products = await api.get<NamedRow[]>("/products");
        productTeamSlug = (products.find((p) => p.id === selected!.product_id)?.team_slug as string) ?? null;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

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
      await open(created.id);
      run();
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      createSaving = false;
    }
  }

  const fmtDate = (d?: string) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  // Live search, debounced; Enter skips the debounce. The very first run (on
  // mount) fires immediately  the spinner is already up, don't sit on it.
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
  {:else}
    <h2>{selected.title}</h2>
    <div class="doc-meta">
      {#if selected.status !== "approved"}<span class="badge {selected.status}">{selected.status}</span>{/if}
      {#if selected.source}<span class="muted">source: {selected.source}</span>{/if}
      {#if selected.updated_at}<span class="muted">updated {fmtDate(selected.updated_at)}</span>{/if}
    </div>
    {#if canEdit}
      <div class="curation">
        <button class="mini" onclick={() => { editing = true; mutateError = null; }}>edit</button>
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
  <p class="intro muted">Freeform project context (runbook, architecture note, process doc). Approved docs are chunked, embedded, and surface in the agent's consult search.</p>
  <ReferenceForm
    mode="create"
    saving={createSaving}
    error={createError}
    onSubmit={createDoc}
    onCancel={() => (creating = false)}
  />
{:else}
  <p class="intro muted">
    Freeform project context the agent can consult: runbooks, architecture notes,
    process docs - anything that isn't an issue→cause→resolution lesson. Docs are
    chunked and embedded; search here is semantic, and the agent pulls matching
    snippets automatically when analyzing tickets.
  </p>
  <div class="controls">
    <input
      class="search"
      placeholder="Search docs by topic, service, procedure…"
      bind:value={q}
      onkeydown={(e) => { if (e.key === "Enter") { clearTimeout(timer); run(); } }}
    />
    {#if !q.trim()}
      <AsciiSelect bind:value={status} title="Doc status"
        options={[{ value: "", label: "any status" }, "draft", "approved", "archived"]} />
    {/if}
    {#if isCurator()}
      <button class="new" onclick={() => (creating = true)}>+ new doc</button>
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
  .intro { margin: 0 0 0.9rem; font-size: 0.88rem; line-height: 1.55; max-width: 60rem; }
  .controls { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; align-items: center; }
  .search { flex: 1; min-width: 16rem; }
  .new { border-color: var(--accent); color: var(--accent); }
  .results { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .row { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 0.25rem; padding: 0.65rem 0.8rem; background: var(--panel); }
  .title { font-weight: 500; }
  .snippet { color: var(--muted); font-size: 0.82rem; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .meta { display: flex; gap: 0.3rem; align-items: baseline; flex-wrap: wrap; }
  .tag { background: var(--accent-dim); border-radius: 999px; padding: 0 0.5rem; font-size: 0.72rem; }
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
  .empty { padding: 1.5rem 0.5rem; }
  .empty p { margin: 0.25rem 0; }
  .muted { color: var(--muted); }
  .error { color: var(--danger); }
</style>
