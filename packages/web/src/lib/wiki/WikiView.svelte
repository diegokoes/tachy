<script lang="ts">
  import { api } from "../api";
  import { navigate, segment } from "../router.svelte";
  import { isCurator } from "../session.svelte";
  import { Button } from "../tui";
  import ArticleView from "./ArticleView.svelte";
  import ArticleForm from "./ArticleForm.svelte";
  import CategoryView from "./CategoryView.svelte";
  import TocView from "./TocView.svelte";
  import CoverageView from "./CoverageView.svelte";
  import type { ReferenceRow, WikiListRow } from "../types";

  /**
   * Routes under /library/wiki:
   *   (none)            the index of wikis
   *   :scope            the main page
   *   :scope/toc        the general table of contents
   *   :scope/coverage   which parts of the product have nothing written
   *   :scope/c/:slug    a category
   *   :scope/new        write a new article
   *   :scope/:slug      an article  ('toc', 'c', 'coverage', 'new' reserved)
   *   :scope/:slug/edit
   */
  const rawScope = $derived(segment(2));
  const third = $derived(segment(3));
  const fourth = $derived(segment(4));
  /** Every branch below the index has a scope; this keeps that fact in the type. */
  const scope = $derived(rawScope ?? "");

  const view = $derived(
    !rawScope
      ? "index"
      : !third
        ? "main"
        : third === "toc"
          ? "toc"
          : third === "coverage"
            ? "coverage"
          : third === "c"
            ? "category"
            : third === "new"
              ? "new"
              : fourth === "edit"
                ? "edit"
                : "article",
  );

  let wikis = $state<WikiListRow[]>([]);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let editing = $state<ReferenceRow | null>(null);

  $effect(() => {
    if (view !== "index") return;
    api
      .get<WikiListRow[]>("/library/wiki")
      .then((rows) => (wikis = rows))
      .catch(() => (wikis = []));
  });

  /** The editor needs the current article; a new one starts from nothing. */
  $effect(() => {
    if (view !== "edit" || !scope || !third) {
      if (view !== "edit") editing = null;
      return;
    }
    api
      .get<ReferenceRow>(`/library/wiki/${scope}/articles/${third}`)
      .then((a) => (editing = a))
      .catch(() => (editing = null));
  });

  const label = (w: WikiListRow) => w.product_name ?? "General (org-wide)";
  const slugOf = (w: WikiListRow) => w.product_slug ?? "general";

  async function create(payload: Record<string, unknown>) {
    saving = true;
    saveError = null;
    try {
      await api.post(`/library/wiki/${scope}/articles`, payload);
      navigate(`/library/wiki/${scope}/${payload.slug}`);
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function save(payload: Record<string, unknown>) {
    saving = true;
    saveError = null;
    try {
      await api.patch(`/library/wiki/${scope}/articles/${third}`, payload);
      navigate(`/library/wiki/${scope}/${payload.slug ?? third}`);
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

{#if view === "index"}
  <div class="index">
    <h2>Wikis</h2>
    <p class="muted sm">
      One per product, plus a general wiki for what belongs to no single one.
    </p>
    <ul>
      {#each wikis as w (slugOf(w))}
        <li>
          <button onclick={() => navigate(`/library/wiki/${slugOf(w)}`)}>
            {label(w)}
          </button>
          <span class="count">
            {w.articles}
            {w.articles === 1 ? "article" : "articles"}
          </span>
        </li>
      {/each}
    </ul>
  </div>
{:else if view === "toc"}
  <TocView {scope} />
{:else if view === "coverage"}
  <CoverageView {scope} />
{:else if view === "category"}
  <CategoryView {scope} slug={fourth ?? ""} />
{:else if view === "new"}
  <ArticleForm
    {scope}
    saving={saving}
    error={saveError}
    onSubmit={create}
    onCancel={() => navigate(`/library/wiki/${scope}/toc`)}
  />
{:else if view === "edit"}
  {#if editing}
    <ArticleForm
      {scope}
      initial={editing}
      saving={saving}
      error={saveError}
      onSubmit={save}
      onCancel={() => navigate(`/library/wiki/${scope}/${third}`)}
    />
  {:else}
    <p class="muted">Loading…</p>
  {/if}
{:else}
  <ArticleView
    {scope}
    slug={view === "main" ? "main" : (third ?? "main")}
    onEdit={() =>
      navigate(
        view === "main"
          ? `/library/wiki/${scope}/main/edit`
          : `/library/wiki/${scope}/${third}/edit`,
      )}
  />
  {#if view === "main"}
    <div class="mainacts">
      <Button variant="ghost" size="sm" onclick={() => navigate(`/library/wiki/${scope}/toc`)}>
        table of contents
      </Button>
      <Button variant="ghost" size="sm" onclick={() => navigate(`/library/wiki/${scope}/coverage`)}>
        coverage
      </Button>
      {#if isCurator()}
        <Button variant="ghost" size="sm" onclick={() => navigate(`/library/wiki/${scope}/new`)}>
          new article
        </Button>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .index {
    max-width: 60ch;
    margin: 0 auto;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-2);
  }
  ul {
    list-style: none;
    margin: var(--pad-2) 0 0;
    padding: 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line, currentColor);
  }
  button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  button:hover {
    text-decoration: underline;
  }
  .count {
    opacity: 0.55;
    font-size: 0.85em;
  }
  .mainacts {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    margin-top: var(--pad-3);
  }
  .muted {
    opacity: 0.6;
  }
  .sm {
    font-size: 0.85em;
  }
</style>
