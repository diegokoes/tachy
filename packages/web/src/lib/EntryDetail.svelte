<script lang="ts">
  import { api, ApiError } from "./api";
  import type { KnowledgeRow, Feedback, NamedRow } from "./types";
  import StructuredView from "./knowledge/StructuredView.svelte";
  import QualityBars from "./knowledge/QualityBars.svelte";
  import EntryForm from "./knowledge/EntryForm.svelte";
  import ScopeCrumb from "./library/ScopeCrumb.svelte";
  import { isCurator, canCurateScope } from "./session.svelte";
  import { pushScope } from "./keys.svelte";
  import { Badge, Button, Chip, Icon } from "./tui";

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

  /** Reading the entry, backspace goes back. Not bound while editing, where it
      would sit one stray keystroke away from discarding a form. */
  $effect(() => {
    if (editing || !entry) return;
    return pushScope([{ key: "backspace", label: "back", run: onClose }]);
  });

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

{#snippet chips(label: string, items: string[] | null | undefined)}
  {#if items && items.length}
    <section>
      <h3>{label}</h3>
      <div class="chips">
        {#each items as it}<Chip>{it}</Chip>{/each}
      </div>
    </section>
  {/if}
{/snippet}

<div class="detail">
  {#if error}<p class="error">{error}</p>{/if}
  {#if entry}
    {#if entry.status === "deprecated"}
      <div class="deprecated-banner">
        <Icon name="alert" size="1em" weight={7} />
        This lesson is marked <strong>outdated</strong> - don't apply it as current advice.
        {#if entry.superseded_by && onOpen}
          <Button size="sm" tone="warn" onclick={() => onOpen(entry!.superseded_by!)}>view replacement</Button>
        {/if}
      </div>
    {/if}

    {#if editing}
      {#if conflict}
        <p class="error">{mutateError} <Button size="sm" onclick={load}>reload</Button></p>
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
        <ScopeCrumb area={entry.product_area} />
        <Button variant="ghost" square icon="back" aria-label="back" title="back (backspace)" onclick={onClose} />
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

      <div class="content">
        <h2>{entry.issue_summary ?? "(no summary)"}</h2>

        <!-- Bars left, status band centred, nothing right — the third track
             keeps the centre optically centred whatever the bars measure. -->
        <div class="meta">
          <div class="left">
            <QualityBars
              confidence={entry.confidence}
              clarity={entry.resolution_clarity}
              learningValue={entry.learning_value}
            />
          </div>

          <div class="mid">
            <div class="band">
              <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
              {#if entry.updated_at}<span class="muted">updated {fmtDate(entry.updated_at)}</span>{/if}
            </div>

            {#if entry.affected_version || entry.fixed_version}
              <div class="versions">
                {#if entry.affected_version}
                  <span class="affected" title="affected version">{entry.affected_version}</span>
                {/if}
                {#if entry.affected_version && entry.fixed_version}
                  <Icon name="versionArrow" size="1.1em" weight={7} label="fixed in" />
                {/if}
                {#if entry.fixed_version}
                  <span class="fixed" title="fixed in version">{entry.fixed_version}</span>
                {/if}
              </div>
            {/if}

            {#if entry.cloud || entry.resolution_pattern || entry.hidden_fix || entry.customer_slug}
              <div class="badges">
                {#if entry.customer_slug}
                  <Badge
                    tone="accent"
                    title="learned on this customer's install — cite it as theirs, not as how the product behaves"
                    >{entry.customer_slug}</Badge
                  >
                {/if}
                {#if entry.cloud}<Badge>{entry.cloud}</Badge>{/if}
                {#if entry.resolution_pattern}<Badge>{entry.resolution_pattern}</Badge>{/if}
                {#if entry.hidden_fix}
                  <Badge tone="accent" title="the real fix wasn't visible on the ticket surface">hidden fix</Badge>
                {/if}
              </div>
            {/if}
          </div>

          <div class="right"></div>
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
            <p class="error">
              {mutateError}
              {#if conflict}<Button size="sm" onclick={load}>reload</Button>{/if}
            </p>
          {/if}

          {#if deprecating}
            <div class="deprecate-form">
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
                <Button
                  variant="ghost" square tone="warn" icon="check"
                  aria-label="deprecate" title="deprecate"
                  busy={mutating}
                  onclick={deprecate}
                />
                <Button
                  variant="ghost" square icon="cancel"
                  aria-label="cancel" title="cancel"
                  disabled={mutating}
                  onclick={() => (deprecating = false)}
                />
              </div>
            </div>
          {/if}
        {/if}

        {#if entry.root_cause}<section><h3>Root cause</h3><p>{entry.root_cause}</p></section>{/if}
        {#if entry.resolution}<section><h3>Resolution</h3><p>{entry.resolution}</p></section>{/if}

        {@render chips("Symptoms", entry.symptoms)}
        {@render chips("Signals", entry.signals)}
        {@render chips("Tags", entry.tags)}

        {#if entry.structured && Object.keys(entry.structured).length}
          <section>
            <h3>Structured context</h3>
            <StructuredView structured={entry.structured} />
          </section>
        {/if}

        <section>
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
      </div>
    {/if}
  {:else if !error}
    <p class="muted">Loading…</p>
  {/if}
</div>

<style>
  /* One reading column: the title, the meta band and every section share the
     same measure and the same side padding, so nothing stops half-way across
     a frame that keeps running. The column is centred in the frame; the prose
     inside stays left-aligned, never justified. 64ch of sans holds the 78
     characters 78ch of mono did — see .prose-measure in base.css. */
  .content {
    max-width: 64ch;
    margin-inline: auto;
    padding: 0 var(--pad-4);
  }

  h2 {
    margin: var(--pad-2) 0 var(--pad-3);
    font-size: var(--fs-lg);
    text-align: center;
  }
  h3 {
    margin: 0 0 var(--pad-2);
    padding-bottom: var(--pad-1);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  section {
    margin-top: var(--pad-4);
  }
  section p {
    margin: 0;
    white-space: pre-wrap;
    line-height: 1.6;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--pad-1);
    padding: var(--pad-2) 0;
    background: var(--panel-solid);
  }
  /* The crumb takes the slack, pushing the actions to the right edge. */
  .topbar :global(nav.crumb) {
    margin-right: auto;
  }

  .meta {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: start;
    gap: var(--gap);
    margin-bottom: var(--pad-3);
    font-size: var(--fs-sm);
  }
  .mid {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-2);
  }
  .band,
  .badges {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--pad-2);
  }
  .versions {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .affected {
    color: var(--warn);
  }
  .fixed {
    color: var(--ok);
  }

  /* Below the reading measure the three tracks stop fitting side by side. */
  @media (max-width: 40rem) {
    .meta {
      grid-template-columns: 1fr;
    }
    .mid {
      align-items: flex-start;
    }
    .band,
    .badges {
      justify-content: flex-start;
    }
    .right {
      display: none;
    }
  }

  .acts {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--pad-2);
    margin: var(--pad-3) 0;
  }
  .acts .gap { width: var(--pad-4); }

  .deprecated-banner {
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    padding: var(--pad-2) var(--pad-3);
    margin-bottom: var(--pad-3);
    font-size: var(--fs-sm);
    display: flex;
    align-items: center;
    gap: var(--pad-3);
    flex-wrap: wrap;
  }
  .deprecate-form {
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    padding: var(--pad-3);
    margin-bottom: var(--pad-3);
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .deprecate-form textarea,
  .deprecate-form input { font: inherit; color: var(--text); }
  .supersede-results { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--pad-1); }
  .supersede-results label { display: flex; align-items: baseline; gap: var(--pad-2); font-size: var(--fs-sm); cursor: pointer; }
  .actions { display: flex; gap: var(--pad-2); }
  .fb-list { list-style: none; padding: 0; margin: 0; }
  .fb-list li { padding: var(--pad-2) 0; border-top: 1px solid var(--border); }
  .muted { color: var(--muted); }
  .error { color: var(--danger); display: flex; align-items: center; gap: var(--pad-2); flex-wrap: wrap; }
</style>
