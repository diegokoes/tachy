<script lang="ts">
  import { fmtDate } from "../dates";
  import { statusTone, type StatusAction } from "./status";
  import { patchLibraryItem } from "./edit";
  import { api } from "../api";
  import type { ReferenceLineageRow, ReferenceRow } from "../types";
  import type { ProductRow } from "@tachy/contract";
  import { canCurateScope, isCurator } from "../session.svelte";
  import Readership from "./Readership.svelte";
  import Backlinks from "./Backlinks.svelte";
  import { renderMarkdown, markBrokenLinks } from "../markdown";
  import { LinkTargets } from "../wikilinks.svelte";
  import { pushScope } from "../keys.svelte";
  import { setTopActions } from "../subnav.svelte";
  import { vimState } from "../vim.svelte";
  import { createSequence, errText } from "../resource.svelte";
  import { Badge, Button, Chip, Icon, Note, Select } from "../tui";
  import ReferenceForm from "../reference/ReferenceForm.svelte";
  import ScopeCrumb from "./ScopeCrumb.svelte";
  import StatusActions from "./StatusActions.svelte";

  let { id, onClose }: { id: string; onClose: () => void } = $props();

  let doc = $state<ReferenceRow | null>(null);
  const links = new LinkTargets();
  let lineage = $state<ReferenceLineageRow[]>([]);
  let error = $state<string | null>(null);
  let editing = $state(false);
  let newVersion = $state(false);
  let mutating = $state(false);
  let mutateError = $state<string | null>(null);
  let conflict = $state(false);
  let productTeamSlug = $state<string | null>(null);
  let createSaving = $state(false);
  let createError = $state<string | null>(null);

  const canEdit = $derived(
    !!doc && canCurateScope({ team_id: doc.team_id, team_slug: productTeamSlug }),
  );


  const versionLabel = (l: ReferenceLineageRow) =>
    `${l.doc_version ? `v${l.doc_version}` : fmtDate(l.created_at) || l.id.slice(0, 8)} · ${l.status}`;

  /** A doc with no recorded lineage is still one version — its own. */
  const versions = $derived<ReferenceLineageRow[]>(
    lineage.length
      ? lineage
      : doc
        ? [
            {
              id: doc.id,
              title: doc.title,
              doc_version: doc.doc_version,
              status: doc.status,
              created_at: doc.created_at,
            },
          ]
        : [],
  );


  /** The doc lifecycle, as the left rail draws it. See EntryDetail. */
  function actionsFor(d: ReferenceRow): StatusAction[] {
    const acts: StatusAction[] = [];
    if (d.status !== "draft")
      acts.push({
        icon: "draft",
        label: "draft",
        title: "back to draft",
        tone: "info",
        disabled: mutating,
        onclick: () => patch({ status: "draft" }),
      });
    if (d.status !== "approved")
      acts.push({
        icon: "approve",
        label: "approve",
        tone: "ok",
        disabled: mutating,
        onclick: () => patch({ status: "approved" }),
      });
    if (d.status !== "archived")
      acts.push({
        icon: "archive",
        label: "archive",
        disabled: mutating,
        onclick: () => patch({ status: "archived" }),
      });
    if (d.status === "approved")
      acts.push({
        icon: "newVersion",
        label: "new version",
        title: "new version\u2026",
        tone: "accent",
        onclick: () => {
          newVersion = true;
          createError = null;
        },
      });
    return acts;
  }

  const statusActions = $derived(doc && canEdit ? actionsFor(doc) : []);

  const current = createSequence();

  async function load(docId: string) {
    // Four awaits deep, and `links` is shared state: without the guard a slow
    // load for the doc you navigated away from lands on top of the one you
    // navigated to, and whichever finishes last is what you read.
    const isCurrent = current();
    error = null;
    editing = false;
    newVersion = false;
    mutateError = null;
    conflict = false;
    productTeamSlug = null;
    doc = null;
    try {
      const next = await api.get<ReferenceRow>(`/reference/${docId}`);
      if (!isCurrent()) return;
      doc = next;
      await links.load("reference", docId);
      if (!isCurrent()) return;
      try {
        const rows = await api.get<ReferenceLineageRow[]>(
          `/reference/${docId}/lineage`,
        );
        if (!isCurrent()) return;
        lineage = rows;
      } catch {
        if (!isCurrent()) return;
        lineage = [];
      }
      // Only for the permission check — the scope is displayed off product_area.
      if (next.product_id) {
        try {
          const products = await api.get<ProductRow[]>("/products");
          if (!isCurrent()) return;
          productTeamSlug =
            products.find((p) => p.id === next.product_id)?.team_slug ?? null;
        } catch {
          if (!isCurrent()) return;
          productTeamSlug = null;
        }
      }
    } catch (e) {
      if (!isCurrent()) return;
      error = errText(e);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!doc) return;
    mutating = true;
    mutateError = null;
    conflict = false;
    const res = await patchLibraryItem(
      `/reference/${doc.id}`,
      body,
      doc.version,
      "doc",
    );
    if (res.ok) await load(doc.id);
    else {
      conflict = res.conflict;
      mutateError = res.message;
    }
    mutating = false;
  }

  async function createDoc(payload: Record<string, unknown>) {
    createSaving = true;
    createError = null;
    try {
      const created = await api.post<{ id: string }>("/reference", payload);
      await load(created.id);
    } catch (e) {
      createError = errText(e);
    } finally {
      createSaving = false;
    }
  }

  $effect(() => {
    load(id);
  });

  /** Same as the entry view: backspace goes back while reading, not editing.
      Hidden, because back is a button in the carved row. */
  $effect(() => {
    if (editing || newVersion || !doc) return;
    return pushScope([
      { key: "backspace", label: "", hidden: true, run: onClose },
      ...(vimState.enabled
        ? [{ key: "esc", label: "", hidden: true, run: onClose }]
        : []),
    ]);
  });

  /* The carved row, while reading. The form claims it while editing. */
  $effect(() => {
    if (editing || newVersion || !doc) return;
    return setTopActions(readActions);
  });
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. -->
{#snippet readActions()}
  <Button size="sm" icon="back" title="back (backspace)" onclick={onClose}
    >back</Button
  >
  {#if canEdit}
    <Button
      size="sm"
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

{#if error}
  <Note tone="danger">{error}</Note>
{:else if !doc}
  <p class="muted">loading…</p>
{:else if editing}
  {#if conflict}
    <Note tone="danger">
      {mutateError}
      {#snippet action()}
        <Button size="sm" onclick={() => load(doc!.id)}>reload</Button>
      {/snippet}
    </Note>
  {/if}
  <ReferenceForm
    mode="edit"
    initial={doc}
    saving={mutating}
    error={conflict ? null : mutateError}
    onSubmit={patch}
    onCancel={() => {
      editing = false;
      mutateError = null;
    }}
  />
{:else if newVersion}
  <ReferenceForm
    mode="create"
    initial={{
      title: doc.title,
      tags: doc.tags,
      body: doc.body,
      status: "approved",
    }}
    supersedes={doc.id}
    saving={createSaving}
    error={createError}
    onSubmit={createDoc}
    onCancel={() => {
      newVersion = false;
      createError = null;
    }}
  />
{:else}
  <div class="read">
    <StatusActions actions={statusActions} />
    <ScopeCrumb area={doc.product_area} />

    <h2>{doc.title}</h2>

    <div class="meta status-meta">
      <span class="lifecycle">
        <Badge tone={statusTone(doc.status)}>{doc.status}</Badge>
        {#if doc.customer_slug}
          <Badge
            tone="accent"
            title="customer-specific; not general product behaviour"
            >{doc.customer_slug}</Badge
          >
        {/if}
      </span>
      <span class="when">
        {#if doc.updated_at}<span class="muted">updated {fmtDate(doc.updated_at)}</span>{/if}
      </span>
    </div>

    <div class="meta">
      <span class="source" title="source">
        <Icon name="search" size="1em" weight={7} />
        <span class:muted={!doc.source}>{doc.source || "n/a"}</span>
      </span>
    </div>

    <div class="meta">
      <Select
        value={doc.id}
        title="All versions of this doc"
        aria-label="version"
        options={versions.map((l) => ({ value: l.id, label: versionLabel(l) }))}
        onchange={(v) => load(String(v))}
      />
    </div>

    {#if canEdit && mutateError}
      <Note tone="danger">
        {mutateError}
        {#snippet action()}
          {#if conflict}
            <Button size="sm" onclick={() => load(doc!.id)}>reload</Button>
          {/if}
        {/snippet}
      </Note>
    {/if}

    {#if doc.tags?.length}
      <div class="tags">
        {#each doc.tags as tag}<Chip>{tag}</Chip>{/each}
      </div>
    {/if}

    <!-- Imported bodies are markdown at the source (an ADO wiki page is), and a
         [[wikilink]] cannot render inside a <pre>. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -- handled on the
             focusable wikilink anchors this div delegates to -->
    <!-- svelte-ignore a11y_no_static_element_interactions -- a delegation
             wrapper, not an interactive element of its own -->
    <div class="body md" onclick={links.onClick} onkeydown={links.onKeydown}>
      {@html markBrokenLinks(renderMarkdown(doc.body ?? "(no body)"), links.resolved)}
    </div>

    <Backlinks base="reference" id={doc.id} />
  </div>
  <Readership
    base="reference"
    id={doc.id}
    version={doc.version}
    {canEdit}
    onReverted={() => load(doc!.id)}
  />
{/if}

<style>
  h2 {
    font-size: var(--fs-lg);
    margin: var(--pad-2) 0 var(--pad-3);
    text-align: center;
  }
  .muted {
    color: var(--muted);
  }
  .meta {
    display: flex;
    gap: var(--pad-3);
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: var(--pad-2);
    font-size: var(--fs-sm);
  }
  /* Three tracks, not a centred flex row: it is the date that has to sit on
     the column's centre line with the badges behind it. Equal fr cheeks give
     it that whatever they hold. */
  .status-meta {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    column-gap: var(--pad-4);
  }
  .lifecycle {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }

  /* The positioning context the lifecycle rail hangs off. */
  /* Grows to fill the frame so the readership lines after it land in the
     bottom-left corner. */
  .read {
    position: relative;
    flex-grow: 1;
  }
  .source {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .tags {
    display: flex;
    gap: var(--pad-1);
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: var(--pad-3);
  }
  .body {
    margin: 0;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--pad-4);
    line-height: 1.55;
    overflow-x: auto;
  }
  /* Imported bodies are not always well-formed markdown, so long unbroken
     strings still have to wrap rather than stretch the panel. */
  .body :global(pre),
  .body :global(code) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
