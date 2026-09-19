<script lang="ts">
  import { MAIN_PAGE_SLUG, slugify } from "@tachy/contract";
  import { createSequence, errText } from "../resource.svelte";
  import { api, ApiError } from "../api";
  import { navigate } from "../router.svelte";
  import { renderMarkdown, markBrokenLinks } from "../markdown";
  import { outline, withAnchors } from "../outline";
  import { isCurator } from "../session.svelte";
  import { setTopActions } from "../subnav.svelte";
  import { Badge, Button, EmptyState, Modal, Note } from "../tui";
  import History from "../library/History.svelte";
  import { patchLibraryItem } from "../library/edit";
  import { statusTone } from "../library/status";
  import { LinkTargets } from "../wikilinks.svelte";
  import type { ReferenceRow } from "../types";
  import ArticleContents from "./ArticleContents.svelte";
  import WikiLayout from "./WikiLayout.svelte";
  import { wikiPath } from "./paths";
  import { loadWikis } from "./wikis.svelte";

  let { scope, slug }: { scope: string; slug: string } = $props();

  let article = $state<ReferenceRow | null>(null);
  let error = $state<string | null>(null);
  let missing = $state(false);
  let historyOpen = $state(false);
  let mutating = $state(false);
  let mutateError = $state<string | null>(null);
  let conflict = $state(false);
  const links = new LinkTargets();

  const items = $derived(article ? outline(article.body ?? "") : []);
  const html = $derived(
    article
      ? markBrokenLinks(
          withAnchors(renderMarkdown(article.body ?? ""), items, {
            numbered: true,
          }),
          links.resolved,
        )
      : "",
  );

  const edit = () => navigate(wikiPath(scope, slug, "edit"));

  $effect(() => {
    void scope;
    void slug;
    load();
  });

  const current = createSequence();

  async function load() {
    // Navigating between articles used to leave the previous body on screen
    // until whichever request finished last won, and `links` is shared state
    // that a slower load would overwrite behind a faster one.
    const isCurrent = current();
    error = null;
    missing = false;
    mutateError = null;
    conflict = false;
    historyOpen = false;
    article = null;
    try {
      const next = await api.get<ReferenceRow>(
        `/library/wiki/${scope}/articles/${slug}`,
      );
      if (!isCurrent()) return;
      article = next;
      await links.load("reference", next.id);
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof ApiError && e.status === 404) missing = true;
      else error = errText(e);
    }
  }

  /** A draft from the agent is approved here, without opening the editor. */
  async function approve() {
    if (!article) return;
    mutating = true;
    mutateError = null;
    conflict = false;
    const res = await patchLibraryItem(
      `/library/wiki/${scope}/articles/${slug}`,
      { status: "approved" },
      article.version,
      "article",
    );
    mutating = false;
    if (res.ok) {
      await load();
      void loadWikis();
    } else {
      conflict = res.conflict;
      mutateError = res.message;
    }
  }

  /**
   * A red link is how a wiki asks for a page. For someone who can write one,
   * following it opens the editor at the slug it wanted — entry and doc links
   * point at ids, and there is nothing to write at an id.
   */
  function onBodyClick(e: MouseEvent) {
    const el = (e.target as HTMLElement)?.closest?.("a.wikilink.broken");
    const target = el?.getAttribute("data-wikilink");
    if (target && isCurator() && !/^(entry|doc):/.test(target)) {
      e.preventDefault();
      navigate(wikiPath(scope, "new", slugify(target)));
      return;
    }
    links.onClick(e);
  }

  $effect(() => {
    if (!article) return;
    return setTopActions(readActions);
  });
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. -->
{#snippet readActions()}
  {#if article && isCurator() && article.status === "draft"}
    <Button
      square
      iconSize="1.25rem"
      tone="ok"
      icon="check"
      title="approve this draft"
      aria-label="approve"
      busy={mutating}
      onclick={approve}
    />
  {/if}
  <Button
    square
    iconSize="1.25rem"
    icon="history"
    title="revisions and reads"
    aria-label="revisions and reads"
    onclick={() => (historyOpen = true)}
  />
  {#if isCurator()}
    <Button
      square
      iconSize="1.25rem"
      tone="info"
      icon="edit"
      title="edit"
      aria-label="edit"
      onclick={edit}
    />
  {/if}
{/snippet}

{#snippet aside()}
  {#if items.length}<ArticleContents {items} />{/if}
  {#if article?.built?.sources}
    <p class="built" class:stale={!!article.built.changed}>
      built from {article.built.entries}
      {article.built.entries === 1 ? "entry" : "entries"} · {article.built.docs}
      {article.built.docs === 1 ? "doc" : "docs"}
    </p>
  {/if}
{/snippet}

<WikiLayout {scope} {aside}>
  {#if error}
    <Note tone="danger">{error}</Note>
  {:else if missing}
    <EmptyState
      icon="doc"
      title={slug === MAIN_PAGE_SLUG ? "No main page yet." : `No article '${slug}' yet.`}
      detail={slug === MAIN_PAGE_SLUG
        ? "Landing page: product summary, entry points."
        : "Linked but not written."}
    >
      {#if isCurator()}
        <Button
          variant="primary"
          icon="edit"
          onclick={() => navigate(wikiPath(scope, "new", slug))}>write it</Button
        >
      {/if}
    </EmptyState>
  {:else if article}
    <article class="wiki">
      <header>
        <h2>{article.title}</h2>
        {#if article.status !== "approved"}
          <Badge tone={statusTone(article.status)}>{article.status}</Badge>
        {/if}
      </header>

      {#if mutateError}
        <Note tone="danger">
          {mutateError}
          {#snippet action()}
            {#if conflict}
              <Button size="sm" onclick={load}>reload</Button>
            {/if}
          {/snippet}
        </Note>
      {/if}

      <!-- A page whose sources have moved is the one worth revisiting, so it
           says so where it is read rather than in a footer. -->
      {#if article.built?.changed}
        <Note tone="warn">
          {article.built.changed}
          {article.built.changed === 1 ? "source has" : "sources have"} changed
          since this was written{article.built.changedTitles.length
            ? `: ${article.built.changedTitles.join(" · ")}`
            : "."}
        </Note>
      {/if}

      <!-- svelte-ignore a11y_click_events_have_key_events -- handled on the
             focusable wikilink anchors this div delegates to -->
      <!-- svelte-ignore a11y_no_static_element_interactions -- a delegation
             wrapper, not an interactive element of its own -->
      <div class="wiki-body md" onclick={onBodyClick} onkeydown={links.onKeydown}>
        {@html html}
      </div>

      <footer class="cats">
        {#if article.categories?.length}
          <span class="lbl">categories:</span>
          {#each article.categories as c, i (c.id)}
            {#if i > 0}<span class="sep">|</span>{/if}
            <a
              href={wikiPath(scope, "c", c.slug)}
              onclick={(e) => {
                e.preventDefault();
                navigate(wikiPath(scope, "c", c.slug));
              }}>{c.name}</a
            >
          {/each}
        {:else}
          <span class="muted">Filed under no category yet.</span>
        {/if}
      </footer>
    </article>

    {#if historyOpen}
      <Modal
        title="history"
        cancelLabel="close"
        width="46rem"
        onCancel={() => (historyOpen = false)}
      >
        <History
          base="reference"
          id={article.id}
          version={article.version}
          canEdit={isCurator()}
          onReverted={load}
        />
      </Modal>
    {/if}
  {:else}
    <p class="muted">loading…</p>
  {/if}
</WikiLayout>

<style>
  .wiki {
    max-width: 78ch;
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
  }
  header {
    display: flex;
    align-items: baseline;
    gap: var(--pad-3);
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--pad-2);
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0;
  }
  .wiki-body {
    line-height: 1.6;
  }
  .wiki-body :global(h1),
  .wiki-body :global(h2),
  .wiki-body :global(h3),
  .wiki-body :global(h4) {
    scroll-margin-top: var(--pad-3);
  }
  .wiki-body :global(h2) {
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--pad-1);
  }
  /* The numbers are the outline's, printed where the reader meets them. */
  .wiki-body :global(.secno) {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    margin-right: 0.35em;
  }
  .wiki-body :global(img) {
    max-width: 100%;
    height: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .wiki-body :global(a.wikilink) {
    cursor: pointer;
    text-decoration: underline;
  }
  /* A link to something that does not exist yet still shows what it meant. */
  .wiki-body :global(a.wikilink.broken) {
    color: var(--danger);
    text-decoration: underline dotted;
  }
  .cats {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--pad-1) var(--pad-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--pad-2) var(--pad-3);
    font-size: var(--fs-sm);
  }
  .cats .lbl {
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
    font-size: var(--fs-xs);
  }
  .cats a {
    color: inherit;
  }
  .sep {
    color: var(--muted);
  }
  .built {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .built.stale {
    color: var(--warn);
  }
  .muted {
    color: var(--muted);
  }
</style>
