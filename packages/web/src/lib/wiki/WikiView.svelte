<script lang="ts">
  import { onMount } from "svelte";
  import { MAIN_PAGE_SLUG } from "@tachy/contract";
  import { api, ApiError } from "../api";
  import { errText } from "../resource.svelte";
  import { navigate, segment } from "../router.svelte";
  import { setSubnav, type SubnavItem } from "../subnav.svelte";
  import { Note } from "../tui";
  import type { ReferenceRow } from "../types";
  import ArticleView from "./ArticleView.svelte";
  import ArticleForm from "./ArticleForm.svelte";
  import CategoryView from "./CategoryView.svelte";
  import OverviewView from "./OverviewView.svelte";
  import GapsView from "./GapsView.svelte";
  import { renamedPage, wikiPath } from "./paths";
  import {
    landingScope,
    loadWikis,
    rememberScope,
    wikis,
  } from "./wikis.svelte";

  /**
   * Routes under /wiki:
   *   (none)              the wiki you were last in
   *   :scope              its landing: intro, sections and coverage in one page
   *   :scope/gaps         what the sweep found missing, over the coverage tree
   *   :scope/c/:slug      a section — its lead article, or its article list
   *   :scope/new[/:slug]  a new article, at a slug something asked for
   *   :scope/:slug        an article — WIKI_RESERVED_SLUGS are never one
   *   :scope/:slug/edit
   * Old addresses (contents, toc, coverage) redirect via renamedPage below.
   */
  /* /wiki resolves to its landing scope in place, before the redirect below
     rewrites the address — otherwise re-picking the wiki tab from a main page
     unmounts the article for a frame and fetches it again. */
  const scope = $derived(
    segment(1) || (wikis.loaded ? landingScope() : ""),
  );
  const second = $derived(segment(2));
  const third = $derived(segment(3));

  const page = $derived(
    !second
      ? "overview"
      : renamedPage(second) !== undefined
        ? "redirect"
        : second === "gaps" || second === "new"
          ? second
          : second === "c"
            ? "category"
            : third === "edit"
              ? "edit"
              : "article",
  );

  const PLACES: SubnavItem[] = [
    { key: "overview", label: "overview", icon: "index" },
    { key: "gaps", label: "gaps", icon: "alert" },
  ];

  /* An article or a section is neither place, so no tab claims it; the aside is
     what says where you are. */
  $effect(() =>
    setSubnav({
      items: PLACES,
      active: page === "overview" || page === "gaps" ? page : "",
      onpick: (k) =>
        navigate(k === "overview" ? wikiPath(scope) : wikiPath(scope, k)),
    }),
  );

  onMount(() => {
    void loadWikis();
  });

  /* /wiki alone opens a wiki rather than a list of them — the switcher is the
     list — and waits for the list so it can pick one that exists. */
  $effect(() => {
    if (segment(1) || !scope) return;
    navigate(wikiPath(scope), { replace: true });
  });

  $effect(() => {
    if (scope) rememberScope(scope);
  });

  /* Old addresses (contents/toc → the landing, coverage → gaps) still resolve. */
  $effect(() => {
    if (!second) return;
    const moved = renamedPage(second);
    if (moved === undefined) return;
    navigate(moved ? wikiPath(scope, moved) : wikiPath(scope), {
      replace: true,
    });
  });

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let editing = $state<ReferenceRow | null>(null);
  let loadError = $state<string | null>(null);

  $effect(() => {
    void page;
    saveError = null;
  });

  /* The editor needs the current article. One that turns out not to exist is
     a new one at that slug — which is what "write it" on an empty main page
     used to reach, and then wait on forever. */
  $effect(() => {
    if (page !== "edit" || !scope || !second) {
      editing = null;
      return;
    }
    const at = second;
    loadError = null;
    api
      .get<ReferenceRow>(`/library/wiki/${scope}/articles/${at}`)
      .then((a) => {
        if (a.slug && a.slug !== at)
          navigate(wikiPath(scope, a.slug, "edit"), { replace: true });
        else editing = a;
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404)
          navigate(wikiPath(scope, "new", at), { replace: true });
        else loadError = errText(e);
      });
  });

  /** The main page's address is the wiki's own, not /main. */
  const articlePath = (slug: string) =>
    slug === MAIN_PAGE_SLUG ? wikiPath(scope) : wikiPath(scope, slug);

  async function create(payload: Record<string, unknown>) {
    saving = true;
    saveError = null;
    try {
      await api.post(`/library/wiki/${scope}/articles`, payload);
      void loadWikis();
      navigate(articlePath(String(payload.slug)));
    } catch (e) {
      saveError = errText(e);
    } finally {
      saving = false;
    }
  }

  async function save(payload: Record<string, unknown>) {
    const at = second!;
    saving = true;
    saveError = null;
    try {
      await api.patch(`/library/wiki/${scope}/articles/${at}`, payload);
      void loadWikis();
      navigate(articlePath(String(payload.slug ?? at)));
    } catch (e) {
      saveError = errText(e);
    } finally {
      saving = false;
    }
  }
</script>

{#if !scope}
  <p class="muted">loading…</p>
{:else if page === "redirect"}
  <p class="muted">loading…</p>
{:else if page === "overview"}
  <OverviewView {scope} />
{:else if page === "gaps"}
  <GapsView {scope} />
{:else if page === "category"}
  <CategoryView {scope} slug={third ?? ""} />
{:else if page === "new"}
  {#key third}
    <ArticleForm
      {scope}
      presetSlug={third ?? null}
      {saving}
      error={saveError}
      onSubmit={create}
      onCancel={() =>
        history.length > 1 ? history.back() : navigate(wikiPath(scope))}
    />
  {/key}
{:else if page === "edit"}
  {#if loadError}
    <Note tone="danger">{loadError}</Note>
  {:else if editing}
    <ArticleForm
      {scope}
      initial={editing}
      {saving}
      error={saveError}
      onSubmit={save}
      onCancel={() => navigate(articlePath(second!))}
    />
  {:else}
    <p class="muted">loading…</p>
  {/if}
{:else}
  <ArticleView {scope} slug={second!} />
{/if}

<style>
  .muted {
    color: var(--muted);
  }
</style>
