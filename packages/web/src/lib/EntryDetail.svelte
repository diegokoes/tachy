<script lang="ts">
  import { api, ApiError } from "./api";
  import type { KnowledgeRow, Feedback, NamedRow } from "./types";
  import Facets from "./Facets.svelte";
  import AsciiSelect from "./AsciiSelect.svelte";
  import StructuredView from "./knowledge/StructuredView.svelte";
  import EntryForm from "./knowledge/EntryForm.svelte";
  import { isCurator, canCurateScope } from "./session.svelte";

  let { id, onClose, onOpen }: { id: string; onClose: () => void; onOpen?: (id: string) => void } = $props();

  let entry = $state<KnowledgeRow | null>(null);
  let feedback = $state<Feedback[]>([]);
  let error = $state<string | null>(null);

  let rating = $state<number>(5);
  let comment = $state("");
  let saving = $state(false);

  // curation state
  let editing = $state(false);
  let mutating = $state(false);
  let mutateError = $state<string | null>(null);
  let conflict = $state(false);
  let productTeamSlug = $state<string | null>(null);

  // deprecate mini-form
  let deprecating = $state(false);
  let deprecateReason = $state("");
  let supersedeQuery = $state("");
  let supersedeResults = $state<KnowledgeRow[]>([]);
  let supersedeId = $state<string | null>(null);

  const canEdit = $derived(
    !!entry && canCurateScope({ team_id: entry.team_id as string | null | undefined, team_slug: productTeamSlug }),
  );

  async function load() {
    error = null;
    conflict = false;
    try {
      entry = await api.get<KnowledgeRow>(`/knowledge/${id}`);
      feedback = await api.get<Feedback[]>(`/knowledge/${id}/feedback`);
      // resolve the owning team for scope-aware controls (product-scoped entries
      // carry no team_id of their own)
      if (isCurator() && entry.product_id && !entry.team_id) {
        const products = await api.get<NamedRow[]>("/products");
        productTeamSlug = (products.find((p) => p.id === entry!.product_id)?.team_slug as string) ?? null;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!entry) return;
    mutating = true;
    mutateError = null;
    conflict = false;
    try {
      await api.patch(`/knowledge/${id}`, { ...body, expectedVersion: entry.version });
      editing = false;
      deprecating = false;
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        conflict = true;
        mutateError = "someone else edited this entry in the meantime - reload to get the latest version";
      } else {
        mutateError = e instanceof Error ? e.message : String(e);
      }
    } finally {
      mutating = false;
    }
  }

  async function deprecate() {
    if (!entry) return;
    mutating = true;
    mutateError = null;
    try {
      if (deprecateReason.trim()) {
        await api.post(`/knowledge/${id}/feedback`, { kind: "deprecation", comment: deprecateReason.trim() });
      }
      await patch({ status: "deprecated", supersededBy: supersedeId });
      deprecateReason = "";
      supersedeQuery = "";
      supersedeResults = [];
      supersedeId = null;
    } catch (e) {
      mutateError = e instanceof Error ? e.message : String(e);
    } finally {
      mutating = false;
    }
  }

  let supersedeTimer: ReturnType<typeof setTimeout> | undefined;
  function searchSupersede() {
    clearTimeout(supersedeTimer);
    supersedeTimer = setTimeout(async () => {
      if (!supersedeQuery.trim()) {
        supersedeResults = [];
        return;
      }
      try {
        const rows = await api.get<KnowledgeRow[]>(`/knowledge/search?q=${encodeURIComponent(supersedeQuery)}&limit=5`);
        supersedeResults = rows.filter((r) => r.id !== id);
      } catch {
        supersedeResults = [];
      }
    }, 250);
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
    editing = false;
    deprecating = false;
    load();
  });
</script>

<div class="detail">
  <button class="close" onclick={onClose}>← back</button>
  {#if error}<p class="error">{error}</p>{/if}
  {#if entry}
    {#if entry.status === "deprecated"}
      <div class="deprecated-banner">
        ⚠ This lesson is marked <strong>outdated</strong> - don't apply it as current advice.
        {#if entry.superseded_by && onOpen}
          <button class="jump" onclick={() => onOpen(entry!.superseded_by!)}>view replacement →</button>
        {/if}
      </div>
    {/if}

    {#if editing}
      <h2>edit entry</h2>
      {#if conflict}
        <p class="error">{mutateError} <button class="mini" onclick={load}>reload</button></p>
      {/if}
      <EntryForm
        mode="edit"
        initial={entry}
        saving={mutating}
        error={conflict ? null : mutateError}
        onSubmit={patch}
        onCancel={() => { editing = false; mutateError = null; }}
      />
    {:else}
      <h2>{entry.issue_summary ?? "(no summary)"}</h2>
      <div class="badges">
        <span class="badge" class:warn={entry.status === "deprecated"}>{entry.status}</span>
        {#if entry.confidence}<span class="badge">confidence: {entry.confidence}</span>{/if}
        {#if entry.cloud}<span class="badge">{entry.cloud}</span>{/if}
        {#if entry.learning_value}<span class="badge">value: {entry.learning_value}</span>{/if}
        {#if entry.resolution_pattern}<span class="badge">{entry.resolution_pattern}</span>{/if}
        {#if entry.product_area}<span class="badge">{entry.product_area}</span>{/if}
        {#if entry.affected_version}<span class="badge">affected: {entry.affected_version}</span>{/if}
        {#if entry.fixed_version}<span class="badge">fixed in: {entry.fixed_version}</span>{/if}
      </div>

      {#if canEdit}
        <div class="curation">
          <button class="mini" onclick={() => { editing = true; mutateError = null; }}>edit</button>
          {#if entry.status === "draft" || entry.status === "rejected"}
            <button class="mini" onclick={() => patch({ status: "approved" })} disabled={mutating}>approve</button>
          {/if}
          {#if entry.status === "deprecated"}
            <button class="mini" onclick={() => patch({ status: "approved", supersededBy: null })} disabled={mutating}>re-approve</button>
          {/if}
          {#if entry.status !== "rejected" && entry.status !== "draft"}
            <button class="mini" onclick={() => patch({ status: "rejected" })} disabled={mutating}>reject</button>
          {/if}
          {#if entry.status !== "archived"}
            <button class="mini" onclick={() => patch({ status: "archived" })} disabled={mutating}>archive</button>
          {/if}
          {#if entry.status === "approved"}
            <button class="mini warn-btn" onclick={() => (deprecating = !deprecating)}>deprecate…</button>
          {/if}
        </div>
        {#if mutateError && !editing}
          <p class="error">{mutateError} {#if conflict}<button class="mini" onclick={load}>reload</button>{/if}</p>
        {/if}

        {#if deprecating}
          <div class="deprecate-form">
            <p class="muted">Mark as outdated: it stays searchable but flagged. Record why, and optionally point at the entry that replaces it.</p>
            <textarea rows="2" bind:value={deprecateReason} placeholder="why is this outdated? (recorded as feedback)"></textarea>
            <input
              placeholder="search for the replacement entry (optional)"
              bind:value={supersedeQuery}
              oninput={searchSupersede}
            />
            {#if supersedeResults.length}
              <ul class="supersede-results">
                {#each supersedeResults as r (r.id)}
                  <li>
                    <label>
                      <input type="radio" name="supersede" checked={supersedeId === r.id}
                        onchange={() => (supersedeId = r.id)} />
                      {r.issue_summary ?? r.id}
                    </label>
                  </li>
                {/each}
                <li>
                  <label>
                    <input type="radio" name="supersede" checked={supersedeId === null}
                      onchange={() => (supersedeId = null)} />
                    <span class="muted">no replacement</span>
                  </label>
                </li>
              </ul>
            {/if}
            <div class="actions">
              <button class="warn-btn" onclick={deprecate} disabled={mutating}>{mutating ? "…" : "deprecate"}</button>
              <button onclick={() => (deprecating = false)} disabled={mutating}>cancel</button>
            </div>
          </div>
        {/if}
      {/if}

      {#if entry.root_cause}<section><h3>Root cause</h3><p>{entry.root_cause}</p></section>{/if}
      {#if entry.resolution}<section><h3>Resolution</h3><p>{entry.resolution}</p></section>{/if}

      <Facets label="Symptoms" items={entry.symptoms} />
      <Facets label="Signals" items={entry.signals} />
      <Facets label="Tags" items={entry.tags} />

      {#if entry.structured && Object.keys(entry.structured).length}
        <section>
          <h3>Structured context</h3>
          <StructuredView structured={entry.structured} />
        </section>
      {/if}

      <section class="feedback">
        <h3>Feedback</h3>
        <div class="fb-form">
          <label>rating
            <AsciiSelect bind:value={rating} options={[1, 2, 3, 4, 5]} />
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
    {/if}
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
  .badge.warn { border-color: var(--warn); color: var(--warn); }
  .deprecated-banner {
    border: 1px solid var(--warn);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    font-size: 0.88rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .jump { font-size: 0.8rem; padding: 0.15rem 0.55rem; border-color: var(--warn); color: var(--warn); }
  .curation { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
  .mini { font-size: 0.78rem; padding: 0.15rem 0.5rem; }
  .warn-btn { border-color: var(--warn); color: var(--warn); }
  .deprecate-form {
    border: 1px solid var(--warn);
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
    margin-bottom: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .deprecate-form textarea, .deprecate-form input { font: inherit; color: var(--text); }
  .supersede-results { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .supersede-results label { display: flex; align-items: baseline; gap: 0.4rem; font-size: 0.85rem; cursor: pointer; }
  .actions { display: flex; gap: 0.5rem; }
  .fb-form { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }
  .fb-form input { flex: 1; min-width: 12rem; }
  .fb-list { list-style: none; padding: 0; margin: 0; }
  .fb-list li { padding: 0.35rem 0; border-top: 1px solid var(--border); }
  .muted { color: var(--muted); }
  .error { color: var(--danger); }
</style>
