<script lang="ts">
  import { api } from "./api";
  import type { KnowledgeRow } from "./types";
  import EntryDetail from "./EntryDetail.svelte";

  let q = $state("");
  let cloud = $state("");
  let learningValue = $state("");
  let rows = $state<KnowledgeRow[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selected = $state<string | null>(null);
  let mode = $state<"search" | "browse">("browse");

  function qs() {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (cloud) p.set("cloud", cloud);
    if (learningValue) p.set("learning_value", learningValue);
    return p.toString();
  }

  async function run() {
    loading = true;
    error = null;
    try {
      // /search needs a query; empty query → browse the latest via list.
      mode = q.trim() ? "search" : "browse";
      const path = mode === "search" ? `/knowledge/search?${qs()}` : `/knowledge?${qs()}`;
      rows = await api.get<KnowledgeRow[]>(path);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    run();
  });
</script>

{#if selected}
  <EntryDetail id={selected} onClose={() => (selected = null)} />
{:else}
  <div class="controls">
    <input
      class="search"
      placeholder="Search symptoms, error codes, root cause…"
      bind:value={q}
      onkeydown={(e) => e.key === "Enter" && run()}
    />
    <select bind:value={cloud} onchange={run}>
      <option value="">any cloud</option>
      <option value="prod">prod</option>
      <option value="qa">qa</option>
      <option value="private-cloud">private-cloud</option>
      <option value="on-prem">on-prem</option>
    </select>
    <select bind:value={learningValue} onchange={run}>
      <option value="">any value</option>
      <option value="high">high</option>
      <option value="medium">medium</option>
      <option value="low">low</option>
    </select>
    <button onclick={run}>Search</button>
  </div>

  {#if error}<p class="error">{error}</p>{/if}
  {#if loading}<p class="muted">Loading…</p>{/if}

  <p class="muted count">{rows.length} {mode === "search" ? "matches" : "entries"}</p>
  <ul class="results">
    {#each rows as r (r.id)}
      <li>
        <button class="row" onclick={() => (selected = r.id)}>
          <span class="summary">{r.issue_summary ?? "(no summary)"}</span>
          <span class="meta">
            {#if r.product_area}{r.product_area} · {/if}
            {#if r.cloud}{r.cloud} · {/if}
            {#if r.confidence}{r.confidence}{/if}
            {#if r.score != null}<span class="score"> · {r.score.toFixed(2)}</span>{/if}
          </span>
        </button>
      </li>
    {/each}
    {#if !loading && rows.length === 0}<li class="muted">No entries.</li>{/if}
  </ul>
{/if}

<style>
  .controls { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
  .search { flex: 1; min-width: 16rem; }
  .count { margin: 0.25rem 0; font-size: 0.82rem; }
  .results { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .row { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 0.2rem; padding: 0.6rem 0.75rem; }
  .summary { font-weight: 500; }
  .meta { color: var(--muted); font-size: 0.8rem; }
  .score { color: var(--accent); }
  .muted { color: var(--muted); }
  .error { color: #f85149; }
</style>
