<script lang="ts">
  import { fmtDate } from "./dates";
  import { statusTone, type StatusAction } from "./library/status";
  import { patchLibraryItem } from "./library/edit";
  import { createSequence } from "./resource.svelte";
  import { api } from "./api";
  import type { KnowledgeRow, Feedback, NamedRow } from "./types";
  import History from "./library/History.svelte";
  import Backlinks from "./library/Backlinks.svelte";
  import { renderMarkdown, markBrokenLinks } from "./markdown";
  import { LinkTargets } from "./wikilinks.svelte";
  import StructuredView from "./knowledge/StructuredView.svelte";
  import { asStructured } from "./knowledge/structured";
  import QualityBars from "./knowledge/QualityBars.svelte";
  import EntryForm from "./knowledge/EntryForm.svelte";
  import ScopeCrumb from "./library/ScopeCrumb.svelte";
  import StatusActions from "./library/StatusActions.svelte";
  import { isCurator, canCurateScope } from "./session.svelte";
  import { pushScope } from "./keys.svelte";
  import { setTopActions } from "./subnav.svelte";
  import { vimState } from "./vim.svelte";
  import { Badge, Button, Chip, Icon, Modal } from "./tui";

  let { id, onClose, onOpen }: { id: string; onClose: () => void; onOpen?: (id: string) => void } = $props();

  let entry = $state<KnowledgeRow | null>(null);
  let feedback = $state<Feedback[]>([]);
  const links = new LinkTargets();

  /**
   * An entry's prose is markdown like an article's, so a [[link]] written in a
   * resolution is followable rather than shown as literal brackets. The stored
   * edge and what the reader sees then agree.
   */
  const prose = (text: string) =>
    markBrokenLinks(renderMarkdown(text), links.resolved);
  let error = $state<string | null>(null);

  let editing = $state(false);
  let mutating = $state(false);
  let mutateError = $state<string | null>(null);
  let conflict = $state(false);
  let productTeamSlug = $state<string | null>(null);

  let historyOpen = $state(false);

  let deprecating = $state(false);
  let deprecateReason = $state("");
  let supersedeQuery = $state("");
  let supersedeResults = $state<KnowledgeRow[]>([]);
  let supersedeId = $state<string | null>(null);

  const canEdit = $derived(
    !!entry && canCurateScope({ team_id: entry.team_id as string | null | undefined, team_slug: productTeamSlug }),
  );


  /**
   * The lifecycle column. Built as a list rather than written out as markup so
   * the rail draws every item the same way, and so which actions apply stays
   * one readable block of status rules.
   */
  function actionsFor(e: KnowledgeRow): StatusAction[] {
    const acts: StatusAction[] = [];
    if (e.status !== "draft")
      acts.push({
        icon: "doc",
        label: "draft",
        title: "back to draft",
        tone: "info",
        disabled: mutating,
        onclick: () => patch({ status: "draft" }),
      });
    if (e.status !== "approved")
      acts.push({
        icon: "check",
        label: e.status === "deprecated" ? "re-approve" : "approve",
        tone: "ok",
        disabled: mutating,
        // Re-approving has to clear the replacement too, or the banner keeps
        // pointing at the entry that superseded this one.
        onclick: () =>
          patch(
            e.status === "deprecated"
              ? { status: "approved", supersededBy: null }
              : { status: "approved" },
          ),
      });
    if (e.status !== "archived")
      acts.push({
        icon: "archive",
        label: "archive",
        disabled: mutating,
        onclick: () => patch({ status: "archived" }),
      });
    if (e.status !== "rejected")
      acts.push({
        icon: "reject",
        label: "reject",
        tone: "danger",
        disabled: mutating,
        onclick: () => patch({ status: "rejected" }),
      });
    if (e.status === "approved")
      acts.push({
        icon: "alert",
        label: "deprecate",
        title: "deprecate\u2026",
        tone: "warn",
        disabled: mutating,
        onclick: () => (deprecating = !deprecating),
      });
    return acts;
  }

  const statusActions = $derived(entry && canEdit ? actionsFor(entry) : []);

  const structured = $derived(asStructured(entry?.structured));

  /** Reading the entry, backspace goes back. Not bound while editing, where it
      would sit one stray keystroke away from discarding a form.

      Hidden: back is a button in the carved row now, so printing it in the
      hint rule as well says the same thing twice. */
  $effect(() => {
    if (editing || !entry) return;
    return pushScope([
      { key: "backspace", label: "", hidden: true, run: onClose },
      // esc is the vim reflex for "back out of here"; backspace stays either way.
      ...(vimState.enabled
        ? [{ key: "esc", label: "", hidden: true, run: onClose }]
        : []),
    ]);
  });

  /* The carved row, while reading. Editing hands it to the form instead, which
     claims it on mount; the disposer's identity check keeps the handover from
     wiping whichever of the two lands second. */
  $effect(() => {
    if (editing || !entry) return;
    return setTopActions(readActions);
  });

  const current = createSequence();

  async function load() {
    const isCurrent = current();
    error = null;
    conflict = false;
    // Cleared with the rest, as DocDetail does: it is only refetched for an
    // entry that has a product and no team of its own, so carrying the last
    // entry's value forward showed an Edit button on another team's entry.
    productTeamSlug = null;
    entry = null;
    try {
      const next = await api.get<KnowledgeRow>(`/knowledge/${id}`);
      if (!isCurrent()) return;
      entry = next;
      const fb = await api.get<Feedback[]>(`/knowledge/${id}/feedback`);
      if (!isCurrent()) return;
      feedback = fb;
      await links.load("knowledge", id);
      if (!isCurrent()) return;

      if (isCurator() && next.product_id && !next.team_id) {
        const products = await api.get<NamedRow[]>("/products");
        if (!isCurrent()) return;
        productTeamSlug =
          (products.find((p) => p.id === next.product_id)
            ?.team_slug as string) ?? null;
      }
    } catch (e) {
      if (!isCurrent()) return;
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!entry) return;
    mutating = true;
    mutateError = null;
    conflict = false;
    const res = await patchLibraryItem(
      `/knowledge/${id}`,
      body,
      entry.version,
      "entry",
    );
    if (res.ok) {
      editing = false;
      deprecating = false;
      await load();
    } else {
      conflict = res.conflict;
      mutateError = res.message;
    }
    mutating = false;
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
    historyOpen = false;
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

<!-- Rendered by App into the carved row beside the subnav, not here. -->
{#snippet readActions()}
  <Button icon="back" title="back (backspace)" onclick={onClose}>back</Button>
  {#if canEdit}
    <Button
      tone="info"
      icon="edit"
      title="edit"
      onclick={() => {
        editing = true;
        mutateError = null;
      }}>edit</Button
    >
  {/if}
{/snippet}

<div class="detail">
  {#if error}<p class="error">{error}</p>{/if}
  {#if entry}
    {#if entry.status === "deprecated"}
      <div class="deprecated-banner">
        <Icon name="alert" size="1em" weight={7} />
        <strong>outdated</strong>: not current advice.
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
      <div class="read">
        <StatusActions actions={statusActions} />
        <ScopeCrumb area={entry.product_area} />

        <div class="content">
          <h2>{entry.issue_summary ?? "(no summary)"}</h2>

          <!-- Bars left, status band centred, nothing right — the third track
               keeps the centre optically centred whatever the bars measure. -->
          <div class="meta">
            <div class="left">
              <QualityBars
                confidence={entry.confidence}
                clarity={entry.resolution_clarity}
              />
            </div>

            <div class="mid">
              <div class="band">
                <span class="lifecycle"><Badge tone={statusTone(entry.status)}>{entry.status}</Badge></span>
                <span class="when">
                  {#if entry.updated_at}<span class="muted">updated {fmtDate(entry.updated_at)}</span>{/if}
                </span>
                <span class="revisions">
                  <Button
                    square
                    iconSize="1.1rem"
                    icon="history"
                    title="revisions and reads"
                    aria-label="revisions and reads"
                    onclick={() => (historyOpen = true)}
                  />
                </span>
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
                      title="customer-specific; not general product behaviour"
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

          <!-- svelte-ignore a11y_click_events_have_key_events -- handled on the
             focusable wikilink anchors this div delegates to -->
          <!-- svelte-ignore a11y_no_static_element_interactions -- a delegation
             wrapper, not an interactive element of its own -->
          {#if entry.root_cause}
            <section>
              <h3>Root cause</h3>
              <div class="md prose" onclick={links.onClick} onkeydown={links.onKeydown}>{@html prose(entry.root_cause)}</div>
            </section>
          {/if}
          {#if entry.resolution}
            <section>
              <h3>Resolution</h3>
              <!-- svelte-ignore a11y_click_events_have_key_events -- handled on the
             focusable wikilink anchors this div delegates to -->
              <!-- svelte-ignore a11y_no_static_element_interactions -- a delegation
             wrapper, not an interactive element of its own -->
              <div class="md prose" onclick={links.onClick} onkeydown={links.onKeydown}>{@html prose(entry.resolution)}</div>
            </section>
          {/if}

          {@render chips("Symptoms", entry.symptoms)}
          {@render chips("Signals", entry.signals)}
          {@render chips("Tags", entry.tags)}

          {#if Object.keys(structured).length}
            <section>
              <h3>Structured context</h3>
              <StructuredView {structured} />
            </section>
          {/if}

          <Backlinks base="knowledge" id={id} />

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

        {#if historyOpen}
          <Modal
            title="history"
            cancelLabel="close"
            width="46rem"
            onCancel={() => (historyOpen = false)}
          >
            <History
              base="knowledge"
              {id}
              version={entry.version}
              {canEdit}
              onReverted={load}
            />
          </Modal>
        {/if}
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
     inside stays left-aligned, never justified. ch tracks the reading face, so
     the measure holds its character count whichever one is picked. */
  .content {
    font-family: var(--font-prose);
    max-width: 64ch;
    margin-inline: auto;
    padding: 0 var(--pad-4);
  }

  /* The positioning context the lifecycle rail hangs off. It wraps the crumb
     and the column both, so the rail's top edge lines up with the crumb rather
     than with whatever banner happens to be above it. */
  .read {
    position: relative;
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
  .badges {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--pad-2);
  }

  /* Three tracks, not a centred flex row: it is the date that has to sit on
     the column's centre line, with the status behind it and the revisions
     button ahead of it. Equal fr cheeks give it that whatever they hold. */
  .band {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    column-gap: var(--pad-4);
  }
  .band .lifecycle {
    justify-self: end;
  }
  .band .revisions {
    justify-self: start;
    display: flex;
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
    .badges {
      justify-content: flex-start;
    }
    .band {
      justify-content: start;
    }
    .right {
      display: none;
    }
  }

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
