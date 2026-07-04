<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./api";
  import type { KnowledgeRow } from "./types";
  import EntryDetail from "./EntryDetail.svelte";
  import LoadingSwarm from "./LoadingSwarm.svelte";

  let q = $state("");
  let cloud = $state("");
  let status = $state("");
  let learningValue = $state("");
  let environments = $state<{ cloud: string; count: number }[]>([]);
  let rows = $state<KnowledgeRow[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selected = $state<string | null>(null);
  let mode = $state<"search" | "browse">("browse");

  const STATUSES = ["draft", "approved", "deprecated", "archived", "rejected"];

  function qs() {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (cloud) p.set("cloud", cloud);
    if (learningValue) p.set("learning_value", learningValue);
    // /search has a fixed approved+deprecated scope; status only applies to list.
    if (status && !q.trim()) p.set("status", status);
    return p.toString();
  }

  async function run() {
    loading = true;
    error = null;
    try {
      // /search needs a query; empty query → browse the latest via list.
      mode = q.trim() ? "search" : "browse";
      const path = mode === "search" ? `/knowledge/search?${qs()}` : `/knowledge?${qs()}`;
      let result = await api.get<KnowledgeRow[]>(path);
      if (mode === "search" && status) result = result.filter((r) => r.status === status);
      rows = result;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function loadEnvironments() {
    try {
      environments = await api.get<{ cloud: string; count: number }[]>("/knowledge/environments");
    } catch {
      environments = [];
    }
  }

  onMount(loadEnvironments);

  // Live search, debounced; Enter skips the debounce.
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void q; void cloud; void status; void learningValue;
    clearTimeout(timer);
    timer = setTimeout(run, 250);
    return () => clearTimeout(timer);
  });
</script>

{#if selected}
  <EntryDetail id={selected} onClose={() => { selected = null; loadEnvironments(); }} onOpen={(id) => (selected = id)} />
{:else}
  <div class="controls">
    <input
      class="search"
      placeholder="Search symptoms, error codes, root cause…"
      bind:value={q}
      onkeydown={(e) => { if (e.key === "Enter") { clearTimeout(timer); run(); } }}
    />
    <select bind:value={cloud} title="Environment observed in">
      <option value="">any environment</option>
      {#each environments as env}
        <option value={env.cloud}>{env.cloud} ({env.count})</option>
      {/each}
    </select>
    <select bind:value={status} title="Entry status">
      <option value="">any status</option>
      {#each STATUSES as s}<option value={s}>{s}</option>{/each}
    </select>
    <select bind:value={learningValue} title="Learning value">
      <option value="">any value</option>
      <option value="high">high</option>
      <option value="medium">medium</option>
      <option value="low">low</option>
    </select>
  </div>

  {#if error}<p class="error">{error}</p>{/if}
  {#if loading}<LoadingSwarm label={mode === "search" ? "searching the archive" : "loading entries"} />{/if}

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
  .controls { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
  .search { flex: 1; min-width: 16rem; }
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
