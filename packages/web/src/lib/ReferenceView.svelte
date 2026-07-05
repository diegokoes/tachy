<script lang="ts">
  import { api } from "./api";
  import type { ReferenceRow } from "./types";
  import Facets from "./Facets.svelte";
  import LoadingSwarm from "./LoadingSwarm.svelte";

  let q = $state("");
  let status = $state("");
  let rows = $state<ReferenceRow[]>([]);
  let selected = $state<ReferenceRow | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let mode = $state<"search" | "browse">("browse");

  async function run() {
    loading = true;
    error = null;
    try {
      mode = q.trim() ? "search" : "browse";
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status && mode === "browse") p.set("status", status);
      const path = mode === "search" ? `/reference/search?${p}` : `/reference?${p}`;
      rows = await api.get<ReferenceRow[]>(path);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function open(id: string) {
    error = null;
    try {
      selected = await api.get<ReferenceRow>(`/reference/${id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const fmtDate = (d?: string) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  // Live search, debounced; Enter skips the debounce.
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void q; void status;
    clearTimeout(timer);
    timer = setTimeout(run, 250);
    return () => clearTimeout(timer);
  });
</script>

{#if selected}
  <button class="close" onclick={() => (selected = null)}>← back</button>
  <h2>{selected.title}</h2>
  <div class="doc-meta">
    {#if selected.status !== "approved"}<span class="badge {selected.status}">{selected.status}</span>{/if}
    {#if selected.source}<span class="muted">source: {selected.source}</span>{/if}
    {#if selected.updated_at}<span class="muted">updated {fmtDate(selected.updated_at)}</span>{/if}
  </div>
  <Facets label="Tags" items={selected.tags} />
  <pre class="body">{selected.body ?? "(no body)"}</pre>
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
      <select bind:value={status} title="Doc status">
        <option value="">any status</option>
        <option value="draft">draft</option>
        <option value="approved">approved</option>
        <option value="archived">archived</option>
      </select>
    {/if}
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  {#if loading}<LoadingSwarm label="searching the docs" />{/if}
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
          </p>
        {/if}
      </li>
    {/if}
  </ul>
{/if}

<style>
  .intro { margin: 0 0 0.9rem; font-size: 0.88rem; line-height: 1.55; max-width: 60rem; }
  .controls { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .search { flex: 1; min-width: 16rem; }
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
  .body { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem; white-space: pre-wrap; line-height: 1.55; overflow-x: auto; }
  .close { margin-bottom: 0.5rem; }
  h2 { font-size: 1.2rem; margin: 0.25rem 0 0.4rem; }
  .empty { padding: 1.5rem 0.5rem; }
  .empty p { margin: 0.25rem 0; }
  .muted { color: var(--muted); }
  .error { color: var(--danger); }
</style>
