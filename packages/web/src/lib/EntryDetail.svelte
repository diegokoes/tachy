<script lang="ts">
  import { api, ApiError } from "./api";
  import type { KnowledgeRow, Feedback, NamedRow } from "./types";
  import Facets from "./Facets.svelte";
  import StructuredView from "./knowledge/StructuredView.svelte";
  import EntryForm from "./knowledge/EntryForm.svelte";
  import { isCurator, canCurateScope } from "./session.svelte";
  import { Badge, Button, Icon } from "./tui";

  let { id, onClose, onOpen }: { id: string; onClose: () => void; onOpen?: (id: string) => void } = $props();

  let entry = $state<KnowledgeRow | null>(null);
  let feedback = $state<Feedback[]>([]);
  let error = $state<string | null>(null);

  let editing = $state(false);
  let mutating = $state(false);
  let mutateError = $state<string | null>(null);
  let conflict = $state(false);
  let productTeamSlug = $state<string | null>(null);

  
  let deprecating = $state(false);
  let deprecateReason = $state("");
  let supersedeQuery = $state("");
  let supersedeResults = $state<KnowledgeRow[]>([]);
  let supersedeId = $state<string | null>(null);

  const canEdit = $derived(
    !!entry && canCurateScope({ team_id: entry.team_id as string | null | undefined, team_slug: productTeamSlug }),
  );

  const fmtDate = (d?: string) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  const statusTone = (s: string) =>
    s === "approved" ? "ok" : s === "draft" ? "accent" : s === "rejected" ? "danger" : s === "deprecated" ? "warn" : "muted";

  async function load() {
    error = null;
    conflict = false;
    try {
      entry = await api.get<KnowledgeRow>(`/knowledge/${id}`);
      feedback = await api.get<Feedback[]>(`/knowledge/${id}/feedback`);
      
      
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

  $effect(() => {
    void id;
    editing = false;
    deprecating = false;
    load();
  });
</script>

<div class="detail">
  {#if error}<p class="error">{error}</p>{/if}
  {#if entry}
    {#if entry.status === "deprecated"}
      <div class="deprecated-banner">
        <Icon name="alert" size="1em" weight={7} />
        This lesson is marked <strong>outdated</strong> - don't apply it as current advice.
        {#if entry.superseded_by && onOpen}
          <button class="jump" onclick={() => onOpen(entry!.superseded_by!)}>view replacement →</button>
        {/if}
      </div>
    {/if}

    {#if editing}
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
      <div class="topbar">
        <Button variant="ghost" square icon="back" aria-label="back" title="back" onclick={onClose} />
        {#if canEdit}
          <Button
            variant="ghost"
            square
            tone="info"
            icon="edit"
            aria-label="edit"
            title="edit"
            onclick={() => { editing = true; mutateError = null; }}
          />
        {/if}
      </div>

      <h2>{entry.issue_summary ?? "(no summary)"}</h2>

      <div class="meta">
        <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
        {#if entry.updated_at}<span class="muted">updated {fmtDate(entry.updated_at)}</span>{/if}
      </div>

      <div class="badges">
        {#if entry.confidence}<Badge>confidence: {entry.confidence}</Badge>{/if}
        {#if entry.cloud}<Badge>{entry.cloud}</Badge>{/if}
        {#if entry.learning_value}<Badge>value: {entry.learning_value}</Badge>{/if}
        {#if entry.resolution_pattern}<Badge>{entry.resolution_pattern}</Badge>{/if}
        {#if entry.product_area}<Badge>{entry.product_area}</Badge>{/if}
        {#if entry.affected_version}<Badge>affected: {entry.affected_version}</Badge>{/if}
        {#if entry.fixed_version}<Badge>fixed in: {entry.fixed_version}</Badge>{/if}
      </div>

      {#if canEdit}
        <div class="acts">
          {#if entry.status !== "draft"}
            <Button
              variant="ghost" square tone="info" icon="doc"
              aria-label="back to draft" title="back to draft"
              disabled={mutating}
              onclick={() => patch({ status: "draft" })}
            />
          {/if}
          {#if entry.status !== "approved"}
            <Button
              variant="ghost" square tone="ok" icon="check"
              aria-label="approve" title={entry.status === "deprecated" ? "re-approve" : "approve"}
              disabled={mutating}
              onclick={() => patch(entry!.status === "deprecated"
                ? { status: "approved", supersededBy: null }
                : { status: "approved" })}
            />
          {/if}
          {#if entry.status !== "archived"}
            <Button
              variant="ghost" square icon="archive"
              aria-label="archive" title="archive"
              disabled={mutating}
              onclick={() => patch({ status: "archived" })}
            />
          {/if}
          <span class="gap"></span>
          {#if entry.status !== "rejected"}
            <Button
              variant="ghost" square tone="danger" icon="cancel"
              aria-label="reject" title="reject"
              disabled={mutating}
              onclick={() => patch({ status: "rejected" })}
            />
          {/if}
          {#if entry.status === "approved"}
            <Button
              variant="ghost" square tone="warn" icon="alert"
              aria-label="deprecate" title="deprecate…"
              disabled={mutating}
              onclick={() => (deprecating = !deprecating)}
            />
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
        {#if feedback.length}
          <ul class="fb-list">
            {#each feedback as f}
              <li><strong>{f.kind}{f.rating ? ` · ${f.rating}★` : ""}</strong> {f.comment ?? ""}</li>
            {/each}
          </ul>
        {:else}
          <p class="muted">No feedback recorded.</p>
        {/if}
      </section>
    {/if}
  {:else if !error}
    <p class="muted">Loading…</p>
  {/if}
</div>

<style>
  h2 { margin: var(--pad-2) 0 var(--pad-3); font-size: 1.25rem; text-align: center; }
  h3 { margin: 1rem 0 0.35rem; font-size: 0.95rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  section p { margin: 0; white-space: pre-wrap; line-height: 1.5; max-width: 72ch; }
  .topbar { display: flex; justify-content: flex-end; align-items: center; gap: var(--pad-1); }
  .meta {
    display: flex; align-items: center; justify-content: center;
    flex-wrap: wrap; gap: var(--pad-3);
    margin-bottom: var(--pad-2); font-size: var(--fs-sm);
  }
  .badges { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--pad-2); margin-bottom: var(--pad-2); }
  .acts {
    display: flex; align-items: center; justify-content: center;
    flex-wrap: wrap; gap: var(--pad-2); margin: var(--pad-3) 0;
  }
  .acts .gap { width: var(--pad-4); }
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
  .mini { font-size: 0.78rem; padding: 0.15rem 0.5rem; }
  .deprecate-form .warn-btn { border-color: var(--warn); color: var(--warn); }
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
  .fb-list { list-style: none; padding: 0; margin: 0; }
  .fb-list li { padding: 0.35rem 0; border-top: 1px solid var(--border); }
  .muted { color: var(--muted); }
  .error { color: var(--danger); }
</style>
