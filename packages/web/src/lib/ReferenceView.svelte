<script lang="ts">
  import { api } from "./api";
  import type { ReferenceRow } from "./types";
  import Facets from "./Facets.svelte";

  let q = $state("");
  let rows = $state<ReferenceRow[]>([]);
  let selected = $state<ReferenceRow | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function run() {
    loading = true;
    error = null;
    try {
      const path = q.trim() ? `/reference/search?q=${encodeURIComponent(q.trim())}` : `/reference`;
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

  $effect(() => {
    run();
  });
</script>

{#if selected}
  <button class="close" onclick={() => (selected = null)}>← back</button>
  <h2>{selected.title}</h2>
  <Facets label="Tags" items={selected.tags} />
  <pre class="body">{selected.body ?? "(no body)"}</pre>
{:else}
  <div class="controls">
    <input
      class="search"
      placeholder="Search reference docs, runbooks, architecture…"
      bind:value={q}
      onkeydown={(e) => e.key === "Enter" && run()}
    />
    <button onclick={run}>Search</button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  {#if loading}<p class="muted">Loading…</p>{/if}
  <ul class="results">
    {#each rows as r (r.id)}
      <li>
        <button class="row" onclick={() => open(r.id)}>
          <span class="title">{r.title}</span>
          {#if r.snippet}<span class="snippet">{r.snippet}</span>{/if}
        </button>
      </li>
    {/each}
    {#if !loading && rows.length === 0}<li class="muted">No reference docs.</li>{/if}
  </ul>
{/if}

<style>
  .controls { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
  .search { flex: 1; }
  .results { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .row { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 0.2rem; padding: 0.6rem 0.75rem; }
  .title { font-weight: 500; }
  .snippet { color: var(--muted); font-size: 0.82rem; }
  .body { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem; white-space: pre-wrap; line-height: 1.5; }
  .close { margin-bottom: 0.5rem; }
  h2 { font-size: 1.2rem; }
  .muted { color: var(--muted); }
  .error { color: #f85149; }
</style>
