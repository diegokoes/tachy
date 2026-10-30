<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import {
    MAX_ENTRY_TITLE_CHARS,
    RELATED_LINK_HINT,
    isRelatedLink,
    type PatternRow,
    type ProductRow,
  } from "@tachy/contract";
  import { KNOWLEDGE_STATUSES, SEARCHED_ENTRY_STATUSES } from "../vocab";
  import { api } from "../api";
  import { createSequence, errText } from "../resource.svelte";
  import { patchLibraryItem } from "../library/edit";
  import { Filing } from "../library/filing.svelte";
  import Reads from "../library/Reads.svelte";
  import Versions from "../library/Versions.svelte";
  import Backlinks from "../library/Backlinks.svelte";
  import ScopeCrumb from "../library/ScopeCrumb.svelte";
  import StatusMenu from "../library/StatusMenu.svelte";
  import { renderMarkdown, markBrokenLinks } from "../markdown/markdown";
  import { LinkTargets } from "../wiki/wikilinks.svelte";
  import { canEditLibraryItem, isCurator } from "../access/session.svelte";
  import { pushScope, type Binding } from "../keys/keys.svelte";
  import { setTopActions } from "../shell/subnav.svelte";
  import { setLeaveGuard } from "../shell/router.svelte";
  import { Button, Modal, Note, ValueList } from "../tui";
  import {
    blankDraft,
    createPayload,
    draftFrom,
    draftProblems,
    editedFields,
    entryPatch,
    fieldLabel,
    holdsProperties,
    rebase,
    withStatus,
    type EntryDraft,
  } from "./draft";
  import type { KnowledgeRow, Feedback } from "./rows";
  import EntrySection from "./EntrySection.svelte";
  import ProseSection from "./ProseSection.svelte";
  import EntryProperties from "./EntryProperties.svelte";
  import DeprecatePanel from "./DeprecatePanel.svelte";
  import { linkLabel } from "./related";

  let {
    id,
    onClose,
    onOpen,
    onCreated,
    extra,
  }: {
    /** Absent for a new entry. */
    id?: string;
    onClose: () => void;
    onOpen?: (id: string) => void;
    onCreated?: (id: string) => void;
    /** Drawn above a new entry, such as the switch to a new doc. */
    extra?: Snippet;
  } = $props();

  /** A new entry starts as one of these; the rest need an entry to judge. */
  const NEW_ENTRY_STATUSES = ["approved", "draft"] as const;
  const DISCARD_ARM_MS = 3000;

  const creating = $derived(!id);
  let entry = $state<KnowledgeRow | null>(null);
  /** The entry as saved; the draft is what the page shows and edits. */
  let baseline = $state.raw<EntryDraft>(blankDraft());
  let draft = $state<EntryDraft>(blankDraft());
  let deprecationReason = $state("");
  let feedback = $state<Feedback[]>([]);
  const links = new LinkTargets();

  let filing = $state(new Filing({}));
  let patterns = $state<PatternRow[]>([]);
  let environments = $state<{ cloud: string; count: number }[]>([]);
  let productTeamSlug = $state<string | null>(null);

  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let conflict = $state(false);
  let saving = $state(false);
  /** A save was tried while something blocked it: the problems are shown. */
  let attempted = $state(false);
  let discardArmed = $state(false);
  let disarmTimer: ReturnType<typeof setTimeout> | undefined;
  /** A navigation held until the person chooses to drop their changes. */
  let pendingLeave = $state<(() => void) | null>(null);

  const canEdit = $derived(
    creating ||
      (!!entry &&
        canEditLibraryItem({
          team_id: entry.team_id,
          product_team_slug: productTeamSlug,
        })),
  );
  const unsaved = $derived(new Set(editedFields(baseline, draft)));
  const dirty = $derived(unsaved.size > 0);
  const problems = $derived(draftProblems(draft, { requireSummary: creating }));
  const blocked = $derived(Object.keys(problems).length > 0);
  const listed = $derived(
    [draft.symptoms, draft.signals, draft.tags, draft.relatedLinks].some(
      (values) => values.length > 0,
    ),
  );
  const deprecating = $derived(
    canEdit &&
      draft.status === "deprecated" &&
      baseline.status !== "deprecated",
  );

  /** Markdown with its [[links]] followable, and the dangling ones marked. */
  const prose = (text: string) =>
    markBrokenLinks(renderMarkdown(text), links.resolved);

  const current = createSequence();

  function seed(row: KnowledgeRow) {
    entry = row;
    baseline = draftFrom(row);
    draft = structuredClone(baseline);
    deprecationReason = "";
    attempted = false;
  }

  async function load(entryId: string) {
    const isCurrent = current();
    loadError = null;
    saveError = null;
    conflict = false;
    entry = null;
    productTeamSlug = null;
    try {
      const row = await api.get<KnowledgeRow>(`/knowledge/${entryId}`);
      if (!isCurrent()) return;
      seed(row);
      const notes = await api.get<Feedback[]>(`/knowledge/${entryId}/feedback`);
      if (!isCurrent()) return;
      feedback = notes;
      await links.load("knowledge", entryId);
      if (!isCurrent()) return;
      if (isCurator() && row.product_id) {
        const products = await api.get<ProductRow[]>("/products");
        if (!isCurrent()) return;
        productTeamSlug =
          products.find((p) => p.id === row.product_id)?.team_slug ?? null;
      }
      if (canEdit) await loadOptions(row);
    } catch (e) {
      if (!isCurrent()) return;
      loadError = errText(e);
    }
  }

  function startBlank() {
    // A load still in flight for the entry before lands nowhere.
    current();
    entry = null;
    baseline = blankDraft();
    draft = blankDraft();
    void loadOptions(null);
  }

  /** What the pickers offer; only loaded for someone who may edit. */
  async function loadOptions(row: KnowledgeRow | null) {
    const options = new Filing(row ?? {});
    filing = options;
    try {
      [patterns, environments] = await Promise.all([
        api.get<PatternRow[]>("/resolution-patterns"),
        api.get<{ cloud: string; count: number }[]>("/knowledge/environments"),
        options.load(),
      ]);
    } catch (e) {
      saveError = errText(e);
    }
  }

  /** Units belong to a customer: the list follows the draft's. */
  async function followCustomer() {
    if (filing.customerSlug === draft.customerSlug) return;
    filing.customerSlug = draft.customerSlug;
    await filing.customerChanged();
  }

  async function refresh() {
    if (!entry) return;
    try {
      const [row, notes] = await Promise.all([
        api.get<KnowledgeRow>(`/knowledge/${entry.id}`),
        api.get<Feedback[]>(`/knowledge/${entry.id}/feedback`),
      ]);
      seed(row);
      feedback = notes;
      await followCustomer();
    } catch (e) {
      saveError = errText(e);
    }
  }

  async function save() {
    if (saving) return;
    if (blocked) {
      attempted = true;
      return;
    }
    if (!dirty) return;
    saving = true;
    saveError = null;
    conflict = false;
    try {
      await (creating ? create() : update());
    } finally {
      saving = false;
    }
  }

  async function create() {
    const productId = filing.products.find(
      (p) => p.slug === filing.productSlug,
    )?.id;
    try {
      const created = await api.post<{ id: string }>("/knowledge", {
        ...createPayload(draft),
        ...(productId ? { productId } : {}),
      });
      // Saved: nothing is left for the leave guard to hold.
      baseline = $state.snapshot(draft);
      onCreated?.(created.id);
    } catch (e) {
      saveError = errText(e);
    }
  }

  async function update() {
    if (!entry) return;
    const reason = deprecating ? deprecationReason.trim() : "";
    const outcome = await patchLibraryItem(
      `/knowledge/${entry.id}`,
      entryPatch(baseline, draft),
      entry.version,
      "entry",
    );
    if (!outcome.ok) {
      conflict = outcome.conflict;
      saveError = outcome.message;
      return;
    }
    if (reason) await recordDeprecation(entry.id, reason);
    await refresh();
  }

  async function recordDeprecation(entryId: string, comment: string) {
    try {
      await api.post(`/knowledge/${entryId}/feedback`, {
        kind: "deprecation",
        comment,
      });
    } catch (e) {
      saveError = `deprecated, but the reason was not recorded: ${errText(e)}`;
    }
  }

  async function reloadKeepingEdits() {
    if (!entry) return;
    try {
      const newer = await api.get<KnowledgeRow>(`/knowledge/${entry.id}`);
      const kept = rebase(draftFrom(newer), baseline, $state.snapshot(draft));
      const reason = deprecationReason;
      seed(newer);
      draft = kept;
      deprecationReason = reason;
      conflict = false;
      saveError = null;
      await followCustomer();
    } catch (e) {
      saveError = errText(e);
    }
  }

  /** The first press arms it; a second within `DISCARD_ARM_MS` discards. */
  function discard() {
    clearTimeout(disarmTimer);
    if (!discardArmed) {
      discardArmed = true;
      disarmTimer = setTimeout(() => (discardArmed = false), DISCARD_ARM_MS);
      return;
    }
    discardArmed = false;
    draft = structuredClone(baseline);
    deprecationReason = "";
    attempted = false;
    conflict = false;
    saveError = null;
    void followCustomer();
  }

  function leaveAnyway() {
    const leave = pendingLeave;
    pendingLeave = null;
    leave?.();
  }

  $effect(() => {
    const entryId = id;
    untrack(() => (entryId ? load(entryId) : startBlank()));
  });

  $effect(() => setTopActions(topActions));

  $effect(() =>
    setLeaveGuard({
      blocks: () => dirty,
      ask: (leave) => (pendingLeave = leave),
    }),
  );

  // Backspace and esc go back only while nothing would be lost; ctrl+s saves
  // from inside a field too.
  $effect(() => {
    const bindings: Binding[] = [];
    if (canEdit)
      bindings.push({
        key: "ctrl+s",
        run: () => void save(),
        inFields: true,
        repeats: false,
      });
    if (!dirty && !creating)
      bindings.push(
        { key: "backspace", run: onClose },
        { key: "esc", run: onClose },
      );
    return pushScope(bindings);
  });

  $effect(() => () => clearTimeout(disarmTimer));
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. -->
{#snippet topActions()}
  {#if creating}
    <Button
      size="sm"
      variant="ghost"
      icon="close"
      disabled={saving}
      onclick={onClose}>cancel</Button
    >
    <Button
      size="sm"
      variant="primary"
      icon="create"
      busy={saving}
      onclick={save}>create</Button
    >
  {:else}
    {#if dirty}
      <!-- The corner holds three buttons only with this one down to its mark. -->
      <Button size="sm" square icon="back" title="library" onclick={onClose} />
      <Button
        size="sm"
        variant="ghost"
        icon="reset"
        tone={discardArmed ? "danger" : undefined}
        disabled={saving}
        onclick={discard}>{discardArmed ? "discard?" : "discard"}</Button
      >
      <Button
        size="sm"
        variant="primary"
        icon="save"
        busy={saving}
        onclick={save}>save</Button
      >
    {:else}
      <Button size="sm" icon="back" onclick={onClose}>library</Button>
    {/if}
  {/if}
{/snippet}

{#snippet linkItem(link: string)}
  <a href={link} target="_blank" rel="noopener noreferrer">{linkLabel(link)}</a>
{/snippet}

<div class="detail">
  {#if loadError}<Note tone="danger">{loadError}</Note>{/if}
  {#if creating || entry}
    {#if creating && extra}<div class="kind">{@render extra()}</div>{/if}
    <div class="page">
      <header class="head">
        {#if entry}<ScopeCrumb area={entry.product_area} />{/if}
        {#if canEdit}
          <input
            class="title"
            class:empty={!draft.title}
            class:unsaved={unsaved.has("title")}
            aria-label="title"
            maxlength={MAX_ENTRY_TITLE_CHARS}
            bind:value={draft.title}
          />
          {#if attempted && problems.title}
            <p class="problem">{problems.title}</p>
          {/if}
        {:else}
          <h2>{draft.title}</h2>
        {/if}

        <div class="status-line">
          <StatusMenu
            status={draft.status}
            statuses={creating ? NEW_ENTRY_STATUSES : KNOWLEDGE_STATUSES}
            searched={SEARCHED_ENTRY_STATUSES}
            onpick={canEdit
              ? (status) => (draft = withStatus(draft, status))
              : undefined}
          />
          {#if entry?.status === "deprecated" && entry.superseded_by && onOpen}
            {@const replacement = entry.superseded_by}
            <button class="replaced" onclick={() => onOpen(replacement)}
              >replaced by ›</button
            >
          {/if}
          {#if entry}
            <span class="sep" aria-hidden="true">·</span>
            <Versions
              base="knowledge"
              id={entry.id}
              at={entry.updated_at}
              version={entry.version}
              canEdit={canEdit && !dirty}
              onReverted={refresh}
            />
            <span class="sep" aria-hidden="true">·</span>
            <Reads
              base="knowledge"
              id={entry.id}
              version={entry.version}
              inline
            />
          {/if}
        </div>

        {#if deprecating && entry}
          <DeprecatePanel
            entryId={entry.id}
            bind:reason={deprecationReason}
            bind:supersededBy={draft.supersededBy}
          />
        {/if}
        {#if conflict}
          <Note tone="danger">
            someone else saved this entry meanwhile; reload keeps your changes
            on top
            {#snippet action()}
              <Button size="sm" onclick={reloadKeepingEdits}>reload</Button>
            {/snippet}
          </Note>
        {:else if saveError}
          <Note tone="danger">{saveError}</Note>
        {/if}
      </header>

      {#if canEdit || holdsProperties(draft) || entry?.work_item_external_id}
        <aside class="facts">
          <EntryProperties
            bind:draft
            {unsaved}
            {canEdit}
            {creating}
            {filing}
            {patterns}
            {environments}
            {entry}
            {problems}
          />
        </aside>
      {/if}

      <div class="content">
        <ProseSection
          label="summary"
          text={draft.issueSummary}
          render={prose}
          {links}
          unsaved={unsaved.has("issueSummary")}
          open={creating}
          problem={attempted ? problems.issueSummary : undefined}
          onchange={canEdit ? (text) => (draft.issueSummary = text) : undefined}
        />
        <ProseSection
          label="root cause"
          text={draft.rootCause}
          render={prose}
          {links}
          unsaved={unsaved.has("rootCause")}
          open={creating}
          onchange={canEdit ? (text) => (draft.rootCause = text) : undefined}
        />
        <ProseSection
          label="resolution"
          text={draft.resolution}
          render={prose}
          {links}
          unsaved={unsaved.has("resolution")}
          open={creating}
          onchange={canEdit ? (text) => (draft.resolution = text) : undefined}
        />
        <ProseSection
          label="investigation"
          text={draft.investigation}
          render={prose}
          {links}
          unsaved={unsaved.has("investigation")}
          open={creating}
          onchange={canEdit
            ? (text) => (draft.investigation = text)
            : undefined}
        />

        {#if entry}<Backlinks base="knowledge" id={entry.id} />{/if}

        {#if feedback.length}
          <EntrySection label="feedback">
            <ul class="feedback">
              {#each feedback as note (note.id)}
                <li>
                  <strong
                    >{note.kind}{note.rating
                      ? ` · ${note.rating}★`
                      : ""}</strong
                  >
                  {note.comment ?? ""}
                </li>
              {/each}
            </ul>
          </EntrySection>
        {/if}
      </div>

      {#if canEdit || listed}
        <aside class="lists">
          {#if canEdit || draft.symptoms.length}
            <EntrySection
              label="symptoms"
              compact
              unsaved={unsaved.has("symptoms")}
            >
              <ValueList
                variant="lines"
                label="symptoms"
                values={draft.symptoms}
                onchange={canEdit
                  ? (values) => (draft.symptoms = values)
                  : undefined}
              />
            </EntrySection>
          {/if}
          {#if canEdit || draft.signals.length}
            <EntrySection
              label="signals"
              compact
              unsaved={unsaved.has("signals")}
            >
              <ValueList
                variant="lines"
                mono
                label="signals"
                values={draft.signals}
                onchange={canEdit
                  ? (values) => (draft.signals = values)
                  : undefined}
              />
            </EntrySection>
          {/if}
          {#if canEdit || draft.tags.length}
            <EntrySection label="tags" compact unsaved={unsaved.has("tags")}>
              <ValueList
                label="tags"
                values={draft.tags}
                onchange={canEdit
                  ? (values) => (draft.tags = values)
                  : undefined}
              />
            </EntrySection>
          {/if}
          {#if canEdit || draft.relatedLinks.length}
            <EntrySection
              label="related links"
              compact
              unsaved={unsaved.has("relatedLinks")}
            >
              <ValueList
                variant="lines"
                label="related links"
                values={draft.relatedLinks}
                item={linkItem}
                accepts={isRelatedLink}
                refusal={RELATED_LINK_HINT}
                onchange={canEdit
                  ? (values) => (draft.relatedLinks = values)
                  : undefined}
              />
            </EntrySection>
          {/if}
        </aside>
      {/if}
    </div>
  {:else if !loadError}
    <p class="muted">loading…</p>
  {/if}
</div>

{#if pendingLeave}
  <Modal
    title="discard unsaved changes?"
    confirmLabel="discard"
    confirmIcon="reset"
    cancelLabel="keep editing"
    danger
    onConfirm={leaveAnyway}
    onCancel={() => (pendingLeave = null)}
  >
    <p>unsaved: {[...unsaved].map(fieldLabel).join(", ")}</p>
  </Modal>
{/if}

<style>
  .detail {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }
  .kind {
    display: flex;
    justify-content: center;
    margin-bottom: var(--pad-3);
  }

  /* The reading column, and the facts and lists beside it once there is
     room; until then the facts sit above the summary and the lists below the
     text. ch tracks the reading face, so the measure holds in any font. */
  .page {
    display: grid;
    grid-template-columns: minmax(0, 76ch);
    justify-content: center;
    column-gap: calc(var(--pad-4) * 4);
    padding: 0 var(--pad-4);
    font-family: var(--font-prose);
  }
  @media (min-width: 72rem) {
    .page {
      grid-template-columns: minmax(0, 76ch) 22rem;
      grid-template-rows: auto auto 1fr;
    }
    .head {
      grid-column: 1;
      grid-row: 1;
    }
    .content {
      grid-column: 1;
      grid-row: 2 / span 2;
    }
    /* Level with the summary's heading. */
    .facts {
      grid-column: 2;
      grid-row: 2;
      padding-top: var(--pad-4);
    }
    .lists {
      grid-column: 2;
      grid-row: 3;
      align-self: start;
    }
  }
  @media (max-width: 72rem) {
    .facts {
      margin-top: var(--pad-3);
    }
  }

  .head {
    text-align: center;
  }
  h2,
  .title {
    margin: var(--pad-2) 0 var(--pad-2);
    font-size: var(--fs-lg);
    font-weight: bold;
    text-align: center;
  }
  /* The title reads as the heading it is until it is pointed at. */
  .title {
    box-sizing: border-box;
    width: 100%;
    padding: var(--pad-1) var(--pad-2);
    font-family: inherit;
    color: var(--text);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
  }
  .title:hover,
  .title:focus,
  .title.empty {
    border-color: var(--border);
    outline: none;
  }
  .title.unsaved {
    color: var(--accent);
  }

  .status-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--pad-2);
    font-size: var(--fs-sm);
  }
  .sep {
    color: var(--muted);
  }
  .replaced {
    padding: 0;
    font: inherit;
    color: var(--warn);
    background: none;
    border: none;
    cursor: pointer;
  }
  .replaced:hover {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .problem {
    margin: 0 0 var(--pad-2);
    font-size: var(--fs-xs);
    color: var(--danger);
  }

  .feedback {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .feedback li {
    padding: var(--pad-2) 0;
    border-top: 1px solid var(--border);
  }
  .muted {
    color: var(--muted);
  }
</style>
