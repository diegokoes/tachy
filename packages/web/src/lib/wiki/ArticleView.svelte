<script lang="ts">
  import { MAIN_PAGE_SLUG, slugify } from "@tachy/contract";
  import { createSequence, errText } from "../resource.svelte";
  import { api, ApiError } from "../api";
  import { navigate } from "../router.svelte";
  import { gsap, reducedMotion } from "../gsap";
  import { renderMarkdown, markBrokenLinks } from "../markdown";
  import { outline, withAnchors } from "../outline";
  import { scrollport } from "../scrollport.svelte";
  import { isCurator } from "../session.svelte";
  import { setTopActions } from "../subnav.svelte";
  import { Badge, Button, EmptyState, Note } from "../tui";
  import Readership from "../library/Readership.svelte";
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

  let titleEl = $state<HTMLElement>();
  let pinnedEl = $state<HTMLElement>();

  /* Once the title scrolls off the top it carries on in the left column, above
     the switcher, travelling from where it was so the eye can follow it. The
     move is scaled by font size alone: Flip would match the two boxes, and a
     title that wraps differently in the narrow column would stretch. */
  $effect(() => {
    const port = scrollport();
    const from = titleEl;
    const to = pinnedEl;
    if (!port || !from || !to) return;
    gsap.set(to, { autoAlpha: 0 });
    let pinned = false;
    const io = new IntersectionObserver(
      ([e]) => {
        const next =
          !e.isIntersecting &&
          e.boundingClientRect.bottom <= (e.rootBounds?.top ?? 0);
        if (next === pinned) return;
        pinned = next;
        gsap.killTweensOf(to);
        if (!pinned) {
          gsap.to(to, { autoAlpha: 0, duration: 0.15 });
          return;
        }
        if (reducedMotion()) {
          gsap.set(to, { autoAlpha: 1, x: 0, y: 0, scale: 1 });
          return;
        }
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const scale =
          parseFloat(getComputedStyle(from).fontSize) /
          parseFloat(getComputedStyle(to).fontSize);
        gsap.fromTo(
          to,
          { x: a.left - b.left, y: a.top - b.top, scale, autoAlpha: 1 },
          {
            x: 0,
            y: 0,
            scale: 1,
            duration: 0.45,
            ease: "power3.out",
            transformOrigin: "0 0",
          },
        );
      },
      { root: port },
    );
    io.observe(from);
    return () => {
      io.disconnect();
      gsap.killTweensOf(to);
    };
  });

  const edit = () => navigate(wikiPath(scope, slug, "edit"));

  $effect(() => {
    void scope;
    void slug;
    load();
  });

  const current = createSequence();

  async function load() {
    // Sequenced: a slower load for the previous article must not replace the
    // body or the shared `links` state behind a faster one.
    const isCurrent = current();
    error = null;
    missing = false;
    mutateError = null;
    conflict = false;
    article = null;
    try {
      const next = await api.get<ReferenceRow>(
        `/library/wiki/${scope}/articles/${slug}`,
      );
      if (!isCurrent()) return;
      if (next.slug && next.slug !== slug) {
        navigate(
          next.slug === MAIN_PAGE_SLUG
            ? wikiPath(scope)
            : wikiPath(scope, next.slug),
          { replace: true },
        );
        return;
      }
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
      icon="approve"
      title="approve this draft"
      aria-label="approve"
      busy={mutating}
      onclick={approve}
    />
  {/if}
  {#if isCurator()}
    <Button size="sm" tone="info" icon="edit" title="edit" onclick={edit}
      >edit</Button
    >
  {/if}
{/snippet}

{#snippet lead()}
  <div class="pin-slot">
    <p class="pinned" bind:this={pinnedEl} aria-hidden="true">
      {article?.title ?? ""}
    </p>
  </div>
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

<WikiLayout {scope} {lead} {aside}>
  {#if error}
    <Note tone="danger">{error}</Note>
  {:else if missing}
    <EmptyState
      icon="file"
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
        <h2 bind:this={titleEl}>{article.title}</h2>
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

      <Readership
        base="reference"
        id={article.id}
        version={article.version}
        canEdit={isCurator()}
        onReverted={load}
      />
    </article>
  {:else}
    <p class="muted">loading…</p>
  {/if}
</WikiLayout>

<style>
  .wiki {
    max-width: 78ch;
    padding-left: calc(var(--pad-4) * 2);
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
  /* Held open for the title that arrives on scroll, so the switcher below it
     never moves. Two lines; a longer title is cut rather than let grow. */
  .pin-slot {
    display: flex;
    align-items: flex-end;
    height: calc(2 * 1.3em + var(--pad-2));
    font-size: var(--fs-md);
  }
  .pinned {
    margin: 0 0 var(--pad-2);
    font-weight: 700;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    visibility: hidden;
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
  .wiki-body :global(pre) {
    overflow-x: auto;
    margin: 0.8em 0;
    padding: var(--pad-2) var(--pad-3);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .wiki-body :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }
  .wiki-body :global(:not(pre) > code) {
    padding: 0.05em 0.3em;
    background: var(--panel);
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

  @media (max-width: 52rem) {
    .wiki {
      padding-left: 0;
    }
  }
</style>
