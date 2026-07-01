<script lang="ts">
  import { api } from "./api";
  import type { KnowledgeRow, Feedback } from "./types";
  import Facets from "./Facets.svelte";

  let { id, onClose }: { id: string; onClose: () => void } = $props();

  let entry = $state<KnowledgeRow | null>(null);
  let feedback = $state<Feedback[]>([]);
  let error = $state<string | null>(null);

  // feedback form
  let rating = $state<number>(5);
  let comment = $state("");
  let saving = $state(false);

  async function load() {
    error = null;
    try {
      entry = await api.get<KnowledgeRow>(`/knowledge/${id}`);
      feedback = await api.get<Feedback[]>(`/knowledge/${id}/feedback`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function submitFeedback() {
    saving = true;
    try {
      await api.post(`/knowledge/${id}/feedback`, {
        kind: "rating",
        rating,
        comment: comment.trim() || undefined,
      });
      comment = "";
      feedback = await api.get<Feedback[]>(`/knowledge/${id}/feedback`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    void id;
    load();
  });
</script>

<div class="detail">
  <button class="close" onclick={onClose}>← back</button>
  {#if error}<p class="error">{error}</p>{/if}
  {#if entry}
    <h2>{entry.issue_summary ?? "(no summary)"}</h2>
    <div class="badges">
      <span class="badge">{entry.status}</span>
      {#if entry.confidence}<span class="badge">confidence: {entry.confidence}</span>{/if}
      {#if entry.cloud}<span class="badge">{entry.cloud}</span>{/if}
      {#if entry.learning_value}<span class="badge">value: {entry.learning_value}</span>{/if}
      {#if entry.resolution_pattern}<span class="badge">{entry.resolution_pattern}</span>{/if}
      {#if entry.product_area}<span class="badge">{entry.product_area}</span>{/if}
    </div>

    {#if entry.root_cause}<section><h3>Root cause</h3><p>{entry.root_cause}</p></section>{/if}
    {#if entry.resolution}<section><h3>Resolution</h3><p>{entry.resolution}</p></section>{/if}

    <Facets label="Symptoms" items={entry.symptoms} />
    <Facets label="Signals" items={entry.signals} />
    <Facets label="Tags" items={entry.tags} />

    {#if entry.structured && Object.keys(entry.structured).length}
      <section>
        <h3>Structured context</h3>
        <pre>{JSON.stringify(entry.structured, null, 2)}</pre>
      </section>
    {/if}

    <section class="feedback">
      <h3>Feedback</h3>
      <div class="fb-form">
        <label>rating
          <select bind:value={rating}>
            {#each [1, 2, 3, 4, 5] as r}<option value={r}>{r}</option>{/each}
          </select>
        </label>
        <input placeholder="optional comment" bind:value={comment} />
        <button onclick={submitFeedback} disabled={saving}>{saving ? "saving…" : "Add"}</button>
      </div>
      {#if feedback.length}
        <ul class="fb-list">
          {#each feedback as f}
            <li><strong>{f.kind}{f.rating ? ` · ${f.rating}★` : ""}</strong> {f.comment ?? ""}</li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No feedback yet.</p>
      {/if}
    </section>
  {:else if !error}
    <p class="muted">Loading…</p>
  {/if}
</div>

<style>
  .detail { max-width: 820px; }
  .close { margin-bottom: 0.75rem; }
  h2 { margin: 0.25rem 0 0.5rem; font-size: 1.25rem; }
  h3 { margin: 1rem 0 0.35rem; font-size: 0.95rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  section p { margin: 0; white-space: pre-wrap; line-height: 1.5; }
  .badges { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.5rem; }
  .badge { border: 1px solid var(--border); border-radius: 6px; padding: 0.1rem 0.5rem; font-size: 0.78rem; color: var(--muted); }
  pre { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; overflow: auto; font-size: 0.82rem; }
  .fb-form { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }
  .fb-form input { flex: 1; min-width: 12rem; }
  .fb-list { list-style: none; padding: 0; margin: 0; }
  .fb-list li { padding: 0.35rem 0; border-top: 1px solid var(--border); }
  .muted { color: var(--muted); }
  .error { color: #f85149; }
</style>
