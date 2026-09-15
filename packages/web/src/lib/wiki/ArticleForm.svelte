<script lang="ts">
  import { onMount, untrack } from "svelte";
  import {
    LIBRARY_ASSET_TYPES,
    MAIN_PAGE_SLUG,
    MAX_ASSET_BYTES,
    slugify,
  } from "@tachy/contract";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { setTopActions } from "../subnav.svelte";
  import { Button, Checkbox, Note } from "../tui";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { componentOptions } from "../catalog";
  import { renderMarkdown } from "../markdown";
  import { outline, withAnchors } from "../outline";
  import { REFERENCE_STATUSES } from "../vocab";
  import type {
    KnowledgeRow,
    NamedRow,
    ReferenceRow,
    WikiArticleRef,
    WikiCategory,
    WikiToc,
    WikiTocNode,
  } from "../types";
  import { uploadImage } from "./images";
  import { ORG_WIDE } from "./paths";
  import { takeSeed } from "./wikis.svelte";

  let {
    scope,
    initial = null,
    presetSlug = null,
    saving = false,
    error = null,
    onSubmit,
    onCancel,
  }: {
    scope: string;
    initial?: ReferenceRow | null;
    /** A new article at an address something already asked for. */
    presetSlug?: string | null;
    saving?: boolean;
    error?: string | null;
    onSubmit: (payload: Record<string, unknown>) => void;
    onCancel: () => void;
  } = $props();

  const seed = untrack(() => initial);
  const preset = untrack(() => presetSlug);
  const editing = !!seed;
  const handed = editing ? null : takeSeed();

  const humanize = (s: string) =>
    s === MAIN_PAGE_SLUG
      ? "Main page"
      : s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

  let title = $state(
    seed?.title ?? handed?.title ?? (preset ? humanize(preset) : ""),
  );
  let slug = $state(seed?.slug ?? preset ?? "");
  let body = $state(seed?.body ?? "");
  let status = $state(seed?.status ?? "approved");
  let chosen = $state<string[]>((seed?.categories ?? []).map((c) => c.slug));
  /** Component slug; the row carries an id, so it is resolved once they load. */
  let component = $state(handed?.component ?? "");
  let components = $state<NamedRow[]>([]);

  let categories = $state<WikiCategory[]>([]);
  let preview = $state(true);

  /** Components belong to a product, and the org-wide wiki has none. */
  const hasComponents = $derived(scope !== ORG_WIDE);

  /* ---- [[ autocomplete ---------------------------------------------------
     Typing `[[` opens a picker over this wiki's articles and the knowledge
     entries; choosing one inserts the link in the form that resolves. Writing
     links by hand means remembering slugs, which is how a wiki ends up with
     none. */
  interface Suggestion {
    insert: string;
    label: string;
    what: string;
  }

  let bodyEl = $state<HTMLTextAreaElement>();
  let fileEl = $state<HTMLInputElement>();
  let picking = $state(false);
  /** Where the `[[` that opened the picker starts, so it can be replaced. */
  let openAt = $state(-1);
  let queryText = $state("");
  let suggestions = $state<Suggestion[]>([]);
  let highlighted = $state(0);
  let articleRefs: WikiArticleRef[] = [];

  async function loadArticles() {
    try {
      const toc = await api.get<WikiToc>(`/library/wiki/${scope}/toc`);
      const seen = new Map<string, WikiArticleRef>();
      const walk = (nodes: WikiTocNode[]) => {
        for (const n of nodes) {
          for (const a of n.articles) if (a.slug) seen.set(a.slug, a);
          walk(n.children);
        }
      };
      walk(toc.categories);
      for (const a of toc.uncategorised) if (a.slug) seen.set(a.slug, a);
      articleRefs = [...seen.values()];
    } catch {
      articleRefs = [];
    }
  }

  async function refreshSuggestions() {
    const q = queryText.trim().toLowerCase();
    const own = articleRefs
      .filter(
        (a) =>
          a.slug !== slug &&
          (!q ||
            a.slug!.toLowerCase().includes(q) ||
            a.title.toLowerCase().includes(q)),
      )
      .slice(0, 6)
      .map((a) => ({ insert: a.slug!, label: a.title, what: "article" }));

    let entries: Suggestion[] = [];
    if (q.length >= 3) {
      try {
        const rows = await api.get<KnowledgeRow[]>(
          `/knowledge/search?q=${encodeURIComponent(q)}&limit=4`,
        );
        entries = rows.map((r) => ({
          insert: `entry:${r.id}`,
          label: r.issue_summary ?? "(no summary)",
          what: "entry",
        }));
      } catch {
        entries = [];
      }
    }
    suggestions = [...own, ...entries];
    highlighted = 0;
  }

  /** Re-reads the caret on every keystroke; `[[` with no `]]` after it is open. */
  function syncPicker() {
    const el = bodyEl;
    if (!el) return;
    const before = body.slice(0, el.selectionStart ?? 0);
    const start = before.lastIndexOf("[[");
    if (start < 0 || before.slice(start).includes("]]")) {
      picking = false;
      return;
    }
    picking = true;
    openAt = start;
    queryText = before.slice(start + 2);
    void refreshSuggestions();
  }

  function choose(s: Suggestion) {
    const el = bodyEl;
    if (!el || openAt < 0) return;
    const caret = el.selectionStart ?? 0;
    const text = s.what === "entry" ? `${s.insert}|${s.label}` : s.insert;
    body = body.slice(0, openAt) + `[[${text}]]` + body.slice(caret);
    picking = false;
    const pos = openAt + text.length + 4;
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onBodyKeydown(e: KeyboardEvent) {
    if (!picking || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlighted = (highlighted + 1) % suggestions.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlighted = (highlighted - 1 + suggestions.length) % suggestions.length;
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(suggestions[highlighted]);
    } else if (e.key === "Escape") {
      picking = false;
    }
  }

  /* ---- images -------------------------------------------------------------
     Pasted, dropped or picked, each goes up on its own and lands in the body
     as ordinary markdown pointing at the stored copy. A placeholder holds its
     place meanwhile, so typing on while it uploads does not lose the spot. */
  let uploadError = $state<string | null>(null);
  let uploads = 0;

  /**
   * An image is a paragraph of its own, figure-like, whatever line the caret
   * happened to be in the middle of — so it is padded with just enough blank
   * lines to stand apart from the text either side of it.
   */
  function insertBlock(text: string) {
    const el = bodyEl;
    const from = el?.selectionStart ?? body.length;
    const to = el?.selectionEnd ?? from;
    const before = body.slice(0, from);
    const after = body.slice(to);
    const gap = (edge: string, full: boolean) =>
      !edge || full ? "" : edge === "\n" ? "\n" : "\n\n";
    const lead = gap(before.slice(-1), !before || before.endsWith("\n\n"));
    const trail = gap(after.slice(0, 1), !after || after.startsWith("\n\n"));
    body = before + lead + text + trail + after;
    const pos = from + lead.length + text.length;
    queueMicrotask(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  const altFrom = (name: string) =>
    name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || "image";

  async function attach(files: File[]) {
    uploadError = null;
    for (const file of files) {
      if (!(LIBRARY_ASSET_TYPES as readonly string[]).includes(file.type)) {
        uploadError = `${file.name}: only PNG, JPEG, GIF or WebP`;
        continue;
      }
      if (file.size > MAX_ASSET_BYTES) {
        uploadError = `${file.name}: larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB`;
        continue;
      }
      const marker = `![uploading ${++uploads}…]()`;
      insertBlock(marker);
      try {
        const { url } = await uploadImage(scope, file);
        body = body.replace(marker, `![${altFrom(file.name)}](${url})`);
      } catch (e) {
        body = body.replace(marker, "");
        uploadError = `${file.name}: ${errText(e)}`;
      }
    }
  }

  const imagesIn = (list: FileList | null | undefined) =>
    [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

  function onPaste(e: ClipboardEvent) {
    const files = imagesIn(e.clipboardData?.files);
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  }

  function onDrop(e: DragEvent) {
    const files = imagesIn(e.dataTransfer?.files);
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  }

  /** What the reader will get, numbered as they will see it. */
  const items = $derived(outline(body));
  const rendered = $derived(
    withAnchors(renderMarkdown(body), items, { numbered: true }),
  );

  onMount(async () => {
    const [cats, comps] = await Promise.all([
      api
        .get<WikiCategory[]>(`/library/wiki/${scope}/categories`)
        .catch(() => [] as WikiCategory[]),
      hasComponents
        ? api
            .get<NamedRow[]>(`/products/${scope}/components`)
            .catch(() => [] as NamedRow[])
        : Promise.resolve([] as NamedRow[]),
    ]);
    categories = cats;
    components = comps;
    if (seed?.component_id)
      component =
        (comps.find((c) => c.id === seed.component_id)?.slug as string) ?? "";
    await loadArticles();
  });

  /** Suggest a slug from the title, but only while creating and untouched. */
  let slugTouched = $state(!!preset);
  $effect(() => {
    if (editing || slugTouched) return;
    slug = slugify(title).slice(0, 60);
  });

  function toggle(catSlug: string) {
    chosen = chosen.includes(catSlug)
      ? chosen.filter((c) => c !== catSlug)
      : [...chosen, catSlug];
  }

  /** Indented by depth so the picker shows the tree, not a flat list. */
  const laidOut = $derived.by(() => {
    const byParent = new Map<string | null, WikiCategory[]>();
    for (const c of categories)
      byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c]);
    const out: { cat: WikiCategory; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const c of byParent.get(parent) ?? []) {
        out.push({ cat: c, depth });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  $effect(() => setTopActions(formActions));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!title.trim() || !slug.trim()) return;
    onSubmit({
      title: title.trim(),
      slug: slug.trim(),
      body,
      status,
      categories: chosen,
      ...(hasComponents
        ? { component: component || (editing ? null : undefined) }
        : {}),
      ...(editing ? { expectedVersion: seed!.version } : {}),
    });
  }
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. The save
     button is outside the <form> in the DOM, so it carries `form` — that keeps
     native required-field validation, which calling submit() directly loses. -->
{#snippet formActions()}
  <Button icon="cancel" disabled={saving} onclick={onCancel}>cancel</Button>
  <Button
    variant="primary"
    icon="save"
    type="submit"
    form="wiki-form"
    title={editing ? "save changes" : "create article"}
    busy={saving}>save</Button
  >
{/snippet}

<form id="wiki-form" class="article-form" onsubmit={submit}>
  <div class="head">
    <label class="grow">
      title
      <input bind:value={title} required />
    </label>
    <label>
      slug
      <input
        bind:value={slug}
        oninput={() => (slugTouched = true)}
        required
      />
    </label>
    <label>
      status
      <AsciiSelect bind:value={status} options={[...REFERENCE_STATUSES]} />
    </label>
    {#if hasComponents}
      <label>
        about
        <AsciiSelect
          bind:value={component}
          title="The part of the product this article is about. It is what coverage and the gap sweep count it against."
          disabled={components.length === 0}
          options={[
            { value: "", label: "the whole product" },
            ...componentOptions(components),
          ]}
        />
      </label>
    {/if}
  </div>

  <div class="cats">
    <span class="lbl">categories</span>
    {#if laidOut.length}
      <div class="picker">
        {#each laidOut as { cat, depth } (cat.id)}
          <label class="cat" style="--depth: {depth}">
            <Checkbox
              checked={chosen.includes(cat.slug)}
              onchange={() => toggle(cat.slug)}
            />
            {cat.name}
          </label>
        {/each}
      </div>
    {:else}
      <span class="muted sm">
        No categories in this wiki yet. The article lands in Uncategorised.
      </span>
    {/if}
  </div>

  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if uploadError}<Note tone="warn">{uploadError}</Note>{/if}

  <div class="split" class:solo={!preview}>
    <!-- svelte-ignore a11y_no_static_element_interactions -- a drop target
         for images, beside the textarea that is the real control -->
    <div class="editor" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
      <span class="lbl">
        body
        <span class="tools">
          <Button
            variant="ghost"
            size="sm"
            icon="attach"
            title="add an image — or paste or drop one into the body"
            onclick={() => fileEl?.click()}>image</Button
          >
          <button type="button" class="toggle" onclick={() => (preview = !preview)}>
            {preview ? "hide preview" : "show preview"}
          </button>
        </span>
      </span>
      <input
        bind:this={fileEl}
        class="file"
        type="file"
        accept={LIBRARY_ASSET_TYPES.join(",")}
        multiple
        onchange={(e) => {
          void attach(imagesIn(e.currentTarget.files));
          e.currentTarget.value = "";
        }}
      />
      <div class="editwrap">
        <textarea
          bind:this={bodyEl}
          bind:value={body}
          aria-label="body"
          spellcheck="false"
          oninput={syncPicker}
          onkeydown={onBodyKeydown}
          onclick={syncPicker}
          onpaste={onPaste}
          onblur={() => setTimeout(() => (picking = false), 150)}
        ></textarea>
        {#if picking && suggestions.length}
          <ul class="picker-pop">
            {#each suggestions as s, i (s.insert)}
              <li>
                <button
                  type="button"
                  class:on={i === highlighted}
                  onmousedown={(e) => {
                    e.preventDefault();
                    choose(s);
                  }}
                >
                  <span class="what">{s.what}</span>
                  {s.label}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    {#if preview}
      <div class="preview">
        <span class="lbl">preview</span>
        <div class="pane md">{@html rendered}</div>
      </div>
    {/if}
  </div>
</form>

<style>
  .article-form {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    height: 100%;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-2);
    align-items: flex-end;
  }
  .grow {
    flex: 1;
    min-width: 14rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .lbl {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted);
    font-size: 0.85em;
  }
  .tools {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .toggle {
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .file {
    display: none;
  }
  .cats .picker {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 1rem;
    margin-top: 0.2rem;
  }
  .cat {
    flex-direction: row;
    align-items: center;
    gap: 0.35rem;
    margin-left: calc(var(--depth) * 1rem);
  }
  /* The editor is the point of this form, so it takes the height. */
  .split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--pad-2);
    flex: 1;
    min-height: 24rem;
  }
  .split.solo {
    grid-template-columns: 1fr;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-height: 0;
  }
  .editwrap {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }
  /* Anchored to the editor rather than the caret: a terminal-styled textarea
     has no caret coordinates to hang a popup off. */
  .picker-pop {
    position: absolute;
    left: 0.5rem;
    bottom: 0.5rem;
    z-index: 5;
    list-style: none;
    margin: 0;
    padding: 0.2rem;
    max-width: 28rem;
    background: var(--panel, #000);
    border: 1px solid var(--line, currentColor);
  }
  .picker-pop button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    padding: 0.15rem 0.4rem;
    cursor: pointer;
  }
  .picker-pop button.on,
  .picker-pop button:hover {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  .picker-pop .what {
    opacity: 0.5;
    font-size: 0.8em;
    margin-right: 0.4rem;
  }
  textarea {
    flex: 1;
    width: 100%;
    resize: none;
    font-family: inherit;
    min-height: 22rem;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-height: 0;
  }
  .pane {
    flex: 1;
    overflow: auto;
    border: 1px solid var(--border);
    padding: 0.6rem 0.8rem;
  }
  .pane :global(.secno) {
    color: var(--muted);
    margin-right: 0.35em;
  }
  .pane :global(img) {
    max-width: 100%;
    height: auto;
  }
  .muted {
    color: var(--muted);
  }
  .sm {
    font-size: 0.85em;
  }

  @media (max-width: 60rem) {
    .split {
      grid-template-columns: 1fr;
    }
  }
</style>
