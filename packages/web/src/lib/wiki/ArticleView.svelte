<script lang="ts">
  import { api, ApiError } from "../api";
  import { navigate } from "../router.svelte";
  import { renderMarkdown, markBrokenLinks } from "../markdown";
  import { outline, withAnchors } from "../outline";
  import { isCurator } from "../session.svelte";
  import { Button, Chip } from "../tui";
  import History from "../library/History.svelte";
  import Backlinks from "./Backlinks.svelte";
  import { LinkTargets } from "../wikilinks.svelte";
  import type { ReferenceRow } from "../types";

  let {
    scope,
    slug,
    onEdit,
  }: { scope: string; slug: string; onEdit: () => void } = $props();

  let article = $state<ReferenceRow | null>(null);
  let error = $state<string | null>(null);
  let missing = $state(false);
  const links = new LinkTargets();

  const items = $derived(article ? outline(article.body ?? "") : []);
  const html = $derived(
    article
      ? markBrokenLinks(
          withAnchors(renderMarkdown(article.body ?? ""), items),
          links.resolved,
        )
      : "",
  );

  $effect(() => {
    void scope;
    void slug;
    load();
  });

  async function load() {
    error = null;
    missing = false;
    try {
      article = await api.get<ReferenceRow>(
        `/library/wiki/${scope}/articles/${slug}`,
      );
      await links.load("reference", article.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        missing = true;
        article = null;
      } else {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }
</script>

{#if error}
  <p class="err">{error}</p>
{:else if missing}
  <div class="empty">
    <h2>{slug}</h2>
    <p class="muted">
      No article here yet.{#if slug === "main"}
        A main page is what a reader lands on — what this product is, where to
        start, what matters.{/if}
    </p>
    {#if isCurator()}
      <Button variant="primary" onclick={onEdit}>write it</Button>
    {/if}
  </div>
{:else if article}
  <article class="wiki">
    <nav class="crumb">
      <a href="/library/wiki/{scope}" onclick={(e) => { e.preventDefault(); navigate(`/library/wiki/${scope}`); }}>
        {scope} wiki
      </a>
      <span class="sep">/</span>
      <a href="/library/wiki/{scope}/toc" onclick={(e) => { e.preventDefault(); navigate(`/library/wiki/${scope}/toc`); }}>
        contents
      </a>
      <span class="sep">/</span>
      <span>{article.title}</span>
    </nav>

    <header>
      <h2>{article.title}</h2>
      {#if isCurator()}
        <Button variant="ghost" size="sm" onclick={onEdit}>edit</Button>
      {/if}
    </header>

    {#if article.status !== "approved"}
      <p class="status">{article.status}</p>
    {/if}

    {#if items.length > 1}
      <nav class="contents" aria-label="Contents">
        <h3>Contents</h3>
        <ol>
          {#each items as it}
            <li style="--depth: {Math.max(0, it.depth - 1)}">
              <a href="#{it.id}">{it.text}</a>
            </li>
          {/each}
        </ol>
      </nav>
    {/if}

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="body md" onclick={links.onClick}>{@html html}</div>

    {#if article.categories?.length}
      <section class="cats">
        <h3>Categories</h3>
        <div class="chips">
          {#each article.categories as c}
            <button
              class="cat"
              onclick={() => navigate(`/library/wiki/${scope}/c/${c.slug}`)}
            >
              <Chip>{c.name}</Chip>
            </button>
          {/each}
        </div>
      </section>
    {:else}
      <p class="muted sm">Filed under nothing yet.</p>
    {/if}

    {#if article.built?.sources}
      <section class="built" class:stale={!!article.built.changed}>
        <h3>Built from</h3>
        <p>
          {article.built.entries}
          {article.built.entries === 1 ? "entry" : "entries"}
          · {article.built.docs} {article.built.docs === 1 ? "doc" : "docs"}
          {#if article.built.changed}
            <strong>
              · {article.built.changed} changed since this was written
            </strong>
          {/if}
        </p>
        {#if article.built.changedTitles.length}
          <ul>
            {#each article.built.changedTitles as t}<li>{t}</li>{/each}
          </ul>
        {/if}
      </section>
    {/if}

    <Backlinks base="reference" id={article.id} />

    <History
      base="reference"
      id={article.id}
      version={article.version}
      canEdit={isCurator()}
      onReverted={load}
    />
  </article>
{:else}
  <p class="muted">Loading…</p>
{/if}

<style>
  .wiki {
    max-width: 70ch;
    margin: 0 auto;
  }
  .crumb {
    font-size: 0.85em;
    opacity: 0.7;
    margin-bottom: var(--pad-2);
  }
  .crumb a {
    color: inherit;
  }
  .crumb .sep {
    margin: 0 0.4rem;
    opacity: 0.5;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-2);
  }
  .status {
    margin: 0 0 var(--pad-2);
    text-transform: uppercase;
    font-size: 0.75em;
    letter-spacing: 0.08em;
    opacity: 0.7;
  }
  /* Boxed like the Arch Wiki's, and floated out of the way on a wide screen. */
  .contents {
    border: 1px solid var(--line, currentColor);
    padding: 0.6rem 1rem;
    margin: 0 0 var(--pad-3);
    display: inline-block;
    min-width: 18rem;
  }
  .contents h3 {
    margin: 0 0 0.3rem;
    font-size: 0.9em;
  }
  .contents ol {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: toc;
  }
  .contents li {
    padding-left: calc(var(--depth) * 1.2rem);
  }
  .contents a {
    color: inherit;
  }
  .body :global(h2),
  .body :global(h3) {
    scroll-margin-top: 1rem;
  }
  .body :global(a.wikilink) {
    cursor: pointer;
    text-decoration: underline;
  }
  /* A link to something that does not exist yet still shows what it meant. */
  .body :global(a.wikilink.broken) {
    color: var(--bad, crimson);
    text-decoration: underline dotted;
    cursor: help;
  }
  .built {
    margin-top: var(--pad-3);
    border-top: 1px solid var(--line, currentColor);
    padding-top: var(--pad-2);
    font-size: 0.9em;
  }
  .built h3 {
    font-size: 0.9em;
    margin: 0 0 0.2rem;
  }
  .built p {
    margin: 0;
  }
  .built ul {
    margin: 0.3rem 0 0;
    padding-left: 1.1rem;
    opacity: 0.75;
  }
  /* A page whose sources have moved is the one worth revisiting. */
  .built.stale strong {
    color: var(--warn, orange);
  }
  .cats {
    margin-top: var(--pad-4);
    border-top: 1px solid var(--line, currentColor);
    padding-top: var(--pad-2);
  }
  .cats h3 {
    font-size: 0.9em;
    margin: 0 0 0.4rem;
  }
  .chips {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .cat {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    color: inherit;
  }
  .empty {
    text-align: center;
    padding: var(--pad-4) 0;
  }
  .muted {
    opacity: 0.6;
  }
  .sm {
    font-size: 0.85em;
  }
  .err {
    color: var(--bad, crimson);
  }
</style>
