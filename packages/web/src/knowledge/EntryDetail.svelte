<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import {
    MAX_ENTRY_TITLE_CHARS,
    RELATED_LINK_HINT,
    isRelatedLink,
    type EntryReview,
    type PatternRow,
    type ProductRow,
    type ProposalRow,
    type Submission,
  } from "@tachy/contract";
  import { KNOWLEDGE_STATUSES, SEARCHED_ENTRY_STATUSES } from "../vocab";
  import { api } from "../api";
  import { createSequence, errText } from "../resource.svelte";
  import { patchLibraryItem } from "../library/edit";
  import { Filing } from "../library/filing.svelte";
  import Reads from "../library/Reads.svelte";
  import Versions from "../library/Versions.svelte";
  import Backlinks from "../library/Backlinks.svelte";
  import StatusMenu from "../library/StatusMenu.svelte";
  import { renderMarkdown, markBrokenLinks } from "../markdown/markdown";
  import { LinkTargets } from "../wiki/wikilinks.svelte";
  import {
    canEditLibraryItem,
    canPropose,
    isCurator,
  } from "../access/session.svelte";
  import { toast } from "../notifications/notify.svelte";
  import { pendingLine } from "../review/changes";
  import { proposalPath } from "../review/queue";
  import { signalLine } from "../review/signals";
  import { loadReviewCounts } from "../review/review.svelte";
  import { pushScope, type Binding } from "../keys/keys.svelte";
  import { setTopActions } from "../shell/subnav.svelte";
  import { navigate, setLeaveGuard } from "../shell/router.svelte";
  import { Button, Field, Modal, Note, ValueList } from "../tui";
  import {
    blankDraft,
    createPayload,
    draftFrom,
    draftProblems,
    editedFields,
    entryPatch,
    fieldLabel,
    holdsProperties,
    patched,
    rebase,
    withStatus,
    type DraftField,
    type EntryDraft,
  } from "./draft";
  import type { KnowledgeRow, Feedback } from "./rows";
  import EntrySection from "./EntrySection.svelte";
  import ProseSection from "./ProseSection.svelte";
  import EntryProperties from "./EntryProperties.svelte";
  import EntryTickets from "./EntryTickets.svelte";
  import DeprecatePanel from "./DeprecatePanel.svelte";
  import { linkLabel } from "./related";

  let {
    id,
    onClose,
    onOpen,
    onCreated,
    extra,
    accepting,
    onAccepted,
  }: {
    /** Absent for a new entry. */
    id?: string;
    onClose: () => void;
    onOpen?: (id: string) => void;
    onCreated?: (id: string) => void;
    /** Drawn above a new entry, such as the switch to a new doc. */
    extra?: Snippet;
    /** A proposal on this entry a reviewer is changing before accepting it. */
    accepting?: ProposalRow;
    onAccepted?: () => void;
  } = $props();

  type ListField = "symptoms" | "signals" | "tags" | "relatedLinks";

  /** A new entry starts as one of these; the rest need an entry to judge. */
  const NEW_ENTRY_STATUSES = ["approved", "draft"] as const;
  const DISCARD_ARM_MS = 3000;
  const MAX_NOTE_CHARS = 2000;
  const NO_PROPOSALS: EntryReview = { mine: null, open: 0, signals: [] };
  const liveStatuses: readonly string[] = SEARCHED_ENTRY_STATUSES;

  const creating = $derived(!id);
  let entry = $state<KnowledgeRow | null>(null);
  /** The entry as saved; the draft is what the page shows and edits. */
  let baseline = $state.raw<EntryDraft>(blankDraft());
  let draft = $state<EntryDraft>(blankDraft());
  let deprecationReason = $state("");
  /** What waits for review on this entry. */
  let proposals = $state.raw<EntryReview>(NO_PROPOSALS);
  /** Why the reader proposes their change. */
  let note = $state("");
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
  /** The list a new value is being typed into. */
  let addingTo = $state<ListField | null>(null);

  const isEditor = $derived(
    creating
      ? isCurator()
      : !!entry &&
          canEditLibraryItem({
            team_id: entry.team_id,
            product_team_slug: productTeamSlug,
          }),
  );
  const pending = $derived(proposals.mine);
  const flaggedSignals = $derived(
    proposals.signals.filter((signal) => signal.flagged),
  );
  const recurrence = $derived(
    proposals.signals.find((signal) => signal.kind === "recurring"),
  );
  /** The reader's own draft, still with a reviewer: theirs to keep editing. */
  const ownsDraft = $derived(
    entry?.status === "draft" && pending?.kind === "new",
  );
  /** The reader's edits go to a reviewer, and the entry stays as it is. */
  const proposing = $derived(
    !isEditor &&
      !ownsDraft &&
      canPropose() &&
      (creating || (!!entry && liveStatuses.includes(entry.status))),
  );
  const canEdit = $derived(isEditor || ownsDraft || proposing);
  const canSetStatus = $derived(
    !accepting && (isEditor || (proposing && !creating)),
  );
  const statusChoices = $derived.by((): readonly string[] => {
    if (creating) return NEW_ENTRY_STATUSES;
    if (proposing && entry) return [...new Set([entry.status, "deprecated"])];
    return KNOWLEDGE_STATUSES;
  });
  /** What the server holds of the reader's edits: the entry under their waiting change. */
  const stored = $derived(
    proposing && pending?.patch ? patched(baseline, pending.patch) : baseline,
  );
  /** The fields that differ from the entry as it is live. */
  const marked = $derived(new Set(editedFields(baseline, draft)));
  const unsaved = $derived(new Set(editedFields(stored, draft)));
  const dirty = $derived(unsaved.size > 0);

  /** The word beside an edited field: on this page only, or already with a reviewer. */
  function markOf(field: DraftField): string {
    if (accepting || !unsaved.has(field)) return "proposed";
    return "unsaved";
  }
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

  /** Shows `row`, with the proposal being accepted or the reader's waiting change over it. */
  function seed(row: KnowledgeRow, waiting: EntryReview) {
    entry = row;
    proposals = waiting;
    baseline = draftFrom(row);
    const patch = accepting?.patch ?? (proposing ? pending?.patch : null);
    draft = patch ? patched(baseline, patch) : structuredClone(baseline);
    deprecationReason = "";
    note = "";
    attempted = false;
  }

  const entryProposals = (entryId: string) =>
    canPropose()
      ? api.get<EntryReview>(`/review/entries/${entryId}`)
      : NO_PROPOSALS;

  /** The team whose admins edit `row`'s product; asked only by someone who is one. */
  async function productTeamOf(row: KnowledgeRow): Promise<string | null> {
    if (!isCurator() || !row.product_id) return null;
    const products = await api.get<ProductRow[]>("/products");
    return products.find((p) => p.id === row.product_id)?.team_slug ?? null;
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
      const [notes, waiting, teamSlug] = await Promise.all([
        api.get<Feedback[]>(`/knowledge/${entryId}/feedback`),
        entryProposals(entryId),
        productTeamOf(row),
      ]);
      if (!isCurrent()) return;
      productTeamSlug = teamSlug;
      feedback = notes;
      seed(row, waiting);
      await links.load("knowledge", entryId);
      if (!isCurrent()) return;
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
    proposals = NO_PROPOSALS;
    note = "";
    // A proposed entry is a draft until a reviewer accepts it.
    baseline = isCurator() ? blankDraft() : withStatus(blankDraft(), "draft");
    draft = structuredClone(baseline);
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
      const [row, notes, waiting] = await Promise.all([
        api.get<KnowledgeRow>(`/knowledge/${entry.id}`),
        api.get<Feedback[]>(`/knowledge/${entry.id}/feedback`),
        entryProposals(entry.id),
      ]);
      seed(row, waiting);
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
    if (!dirty && !accepting) return;
    saving = true;
    saveError = null;
    conflict = false;
    try {
      if (creating) await create();
      else if (accepting) await accept();
      else await update();
    } finally {
      saving = false;
    }
  }

  /** The reason sent with a proposal; a deprecation's reason stands in for it. */
  function proposalNote(): { note?: string } {
    const reason = (note || deprecationReason).trim();
    return proposing && reason ? { note: reason } : {};
  }

  function sentForReview() {
    toast("sent for review");
    void loadReviewCounts();
  }

  async function create() {
    const productId = filing.products.find(
      (p) => p.slug === filing.productSlug,
    )?.id;
    try {
      const created = await api.post<Submission>("/knowledge", {
        ...createPayload(draft),
        ...(productId ? { productId } : {}),
        ...proposalNote(),
      });
      if (created.proposed) sentForReview();
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
      { ...entryPatch(baseline, draft), ...proposalNote() },
      entry.version,
      "entry",
    );
    if (!outcome.ok) {
      conflict = outcome.conflict;
      saveError = outcome.message;
      return;
    }
    if (proposing) sentForReview();
    else if (reason) await recordDeprecation(entry.id, reason);
    await refresh();
  }

  /** Accepts the proposal with the page's values, which may be the reviewer's own. */
  async function accept() {
    if (!entry || !accepting) return;
    try {
      await api.post(`/review/proposals/${accepting.id}/accept`, {
        edits: {
          ...entryPatch(baseline, draft),
          expectedVersion: entry.version,
        },
      });
      // Accepted: nothing is left for the leave guard to hold.
      baseline = $state.snapshot(draft);
      onAccepted?.();
    } catch (e) {
      saveError = errText(e);
    }
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
      seed(newer, proposals);
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
    draft = structuredClone(stored);
    deprecationReason = "";
    note = "";
    attempted = false;
    conflict = false;
    saveError = null;
    void followCustomer();
  }

  function stopAdding(field: ListField) {
    if (addingTo === field) addingTo = null;
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
      onclick={save}>{isEditor ? "create" : "propose"}</Button
    >
  {:else if accepting}
    <Button size="sm" icon="back" disabled={saving} onclick={onClose}
      >review</Button
    >
    <Button
      size="sm"
      variant="primary"
      icon="approve"
      busy={saving}
      onclick={save}>accept</Button
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
        onclick={save}>{proposing ? "propose" : "save"}</Button
      >
    {:else}
      <Button size="sm" icon="back" onclick={onClose}>library</Button>
    {/if}
  {/if}
{/snippet}

{#snippet addButton(field: ListField, label: string)}
  {#if canEdit}
    <Button
      variant="ghost"
      size="sm"
      square
      icon="plus"
      title="add to {label}"
      onclick={() => (addingTo = field)}
    />
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
        <div class="title-block">
          {#if canEdit}
            <input
              class="title"
              class:empty={!draft.title}
              class:unsaved={marked.has("title")}
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
        </div>

        <div class="status-block">
          <div class="status-line">
            <StatusMenu
              status={draft.status}
              statuses={statusChoices}
              searched={SEARCHED_ENTRY_STATUSES}
              onpick={canSetStatus
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
                canEdit={isEditor && !accepting && !dirty}
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
          {#if proposing && !deprecating && (dirty || creating)}
            <Field
              label="reason"
              info="why the entry should change; the reviewer reads it with the change"
            >
              <input bind:value={note} maxlength={MAX_NOTE_CHARS} />
            </Field>
          {/if}
          {#if pending && !accepting}
            {@const waitingChange = pending}
            <Note
              tone={waitingChange.status === "returned" ? "warn" : "accent"}
            >
              {pendingLine(waitingChange)}
              {#snippet action()}
                <Button
                  size="sm"
                  onclick={() => navigate(proposalPath(waitingChange.id))}
                  >open</Button
                >
              {/snippet}
            </Note>
          {:else if isEditor && proposals.open && !accepting}
            <Note tone="accent">
              {proposals.open}
              {proposals.open === 1
                ? "proposed change waits"
                : "proposed changes wait"} for review
              {#snippet action()}
                <Button size="sm" onclick={() => navigate("/review")}
                  >open</Button
                >
              {/snippet}
            </Note>
          {/if}
          {#if !accepting}
            {#each flaggedSignals as signal (signal.id)}
              <Note tone="warn">flagged: {signalLine(signal)}</Note>
            {/each}
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
        </div>
      </header>

      <div class="side">
        {#if canEdit || holdsProperties(draft)}
          <div class="facts">
            <EntryProperties
              bind:draft
              unsaved={marked}
              {canEdit}
              {creating}
              {filing}
              {patterns}
              {environments}
              {problems}
            />
          </div>
        {/if}
        {#if canEdit || listed}
          <div class="lists">
            {#if canEdit || draft.symptoms.length}
              <EntrySection
                label="symptoms"
                compact
                unsaved={marked.has("symptoms")}
                mark={markOf("symptoms")}
                active={addingTo === "symptoms"}
              >
                {#snippet action()}{@render addButton(
                    "symptoms",
                    "symptoms",
                  )}{/snippet}
                <ValueList
                  variant="lines"
                  label="symptom"
                  values={draft.symptoms}
                  adding={addingTo === "symptoms"}
                  ondone={() => stopAdding("symptoms")}
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
                unsaved={marked.has("signals")}
                mark={markOf("signals")}
                active={addingTo === "signals"}
              >
                {#snippet action()}{@render addButton(
                    "signals",
                    "signals",
                  )}{/snippet}
                <ValueList
                  variant="lines"
                  mono
                  label="signal"
                  values={draft.signals}
                  adding={addingTo === "signals"}
                  ondone={() => stopAdding("signals")}
                  onchange={canEdit
                    ? (values) => (draft.signals = values)
                    : undefined}
                />
              </EntrySection>
            {/if}
            {#if canEdit || draft.tags.length}
              <EntrySection
                label="tags"
                compact
                unsaved={marked.has("tags")}
                mark={markOf("tags")}
                active={addingTo === "tags"}
              >
                {#snippet action()}{@render addButton("tags", "tags")}{/snippet}
                <ValueList
                  label="tag"
                  values={draft.tags}
                  adding={addingTo === "tags"}
                  ondone={() => stopAdding("tags")}
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
                unsaved={marked.has("relatedLinks")}
                mark={markOf("relatedLinks")}
                active={addingTo === "relatedLinks"}
              >
                {#snippet action()}{@render addButton(
                    "relatedLinks",
                    "related links",
                  )}{/snippet}
                <ValueList
                  variant="lines"
                  label="related link"
                  values={draft.relatedLinks}
                  item={linkItem}
                  accepts={isRelatedLink}
                  refusal={RELATED_LINK_HINT}
                  adding={addingTo === "relatedLinks"}
                  ondone={() => stopAdding("relatedLinks")}
                  onchange={canEdit
                    ? (values) => (draft.relatedLinks = values)
                    : undefined}
                />
              </EntrySection>
            {/if}
          </div>
        {/if}
        {#if entry}
          <EntryTickets
            entryId={entry.id}
            version={entry.version}
            canRemove={isEditor && !accepting}
            canUpdate={canEdit && !accepting}
            {recurrence}
          />
        {/if}
      </div>

      <div class="content">
        <ProseSection
          label="summary"
          text={draft.issueSummary}
          render={prose}
          {links}
          unsaved={marked.has("issueSummary")}
          mark={markOf("issueSummary")}
          open={creating}
          problem={attempted ? problems.issueSummary : undefined}
          onchange={canEdit ? (text) => (draft.issueSummary = text) : undefined}
        />
        <ProseSection
          label="root cause"
          text={draft.rootCause}
          render={prose}
          {links}
          unsaved={marked.has("rootCause")}
          mark={markOf("rootCause")}
          open={creating}
          onchange={canEdit ? (text) => (draft.rootCause = text) : undefined}
        />
        <ProseSection
          label="resolution"
          text={draft.resolution}
          render={prose}
          {links}
          unsaved={marked.has("resolution")}
          mark={markOf("resolution")}
          open={creating}
          onchange={canEdit ? (text) => (draft.resolution = text) : undefined}
        />
        <ProseSection
          label="investigation"
          text={draft.investigation}
          render={prose}
          {links}
          unsaved={marked.has("investigation")}
          mark={markOf("investigation")}
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

  /* Facts and lists beside the text from under the title down; on a narrow
     window the facts go above the summary and the lists below the text. ch
     tracks the reading face, so the measure holds in any font. */
  .page {
    display: grid;
    grid-template-columns: minmax(0, 76ch);
    justify-content: center;
    column-gap: calc(var(--pad-4) * 4);
    padding: 0 var(--pad-4);
    font-family: var(--font-prose);
  }
  @media (min-width: 72rem) {
    /* The header lends the page its title and status rows, so the side column
       starts under the title. A long side column grows the flexible text row,
       not the status row, which would push the text down. */
    .page {
      grid-template-columns: minmax(0, 76ch) 22rem;
      grid-template-rows: auto auto 1fr;
    }
    .head {
      display: grid;
      grid-template-rows: subgrid;
      grid-column: 1;
      grid-row: 1 / span 2;
    }
    .content {
      grid-column: 1;
      grid-row: 3;
    }
    /* The status text sits in a button padded by --pad-1; the same padding
       keeps the first fact level with it. */
    .side {
      grid-column: 2;
      grid-row: 2 / span 2;
      align-self: start;
      padding-top: var(--pad-1);
    }
  }
  @media (max-width: 72rem) {
    .side {
      display: contents;
    }
    .facts {
      margin-top: var(--pad-3);
    }
    .lists {
      order: 1;
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
