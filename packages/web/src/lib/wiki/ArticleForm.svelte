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
  import { Button, Checkbox, Field, FormActions, Note } from "../tui";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { componentOptions } from "../catalog";
  import type { ComponentRow } from "@tachy/contract";
  import { CALLOUT_TYPES, renderMarkdown } from "../markdown";
  import { outline, withAnchors } from "../outline";
  import { REFERENCE_STATUSES } from "../vocab";
  import type {
    KnowledgeRow,
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
  let components = $state<ComponentRow[]>([]);

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
  let picking = $state(false);
  /** Where the `[[` or the `>` that opened the picker starts. */
  let openAt = $state(-1);
  let mode = $state<"link" | "callout">("link");
  /** Whether Enter belongs to the picker. A bare `>` is also the start of an
   *  ordinary blockquote, and Enter there is a newline until a type is asked
   *  for — by opening the marker, or by arrowing into the list. */
  let armed = $state(true);
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

  /**
   * Re-reads the caret on every keystroke. Two openings: `[[` with no `]]`
   * after it, and a line begun with `>`, which offers the callouts so their
   * types need not be remembered either.
   */
  function syncPicker() {
    const el = bodyEl;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const before = body.slice(0, caret);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const callout = /^>[ \t]*(?:\[!?([\w-]*))?$/.exec(line);
    if (callout) {
      const q = (callout[1] ?? "").toLowerCase();
      mode = "callout";
      armed = line.includes("[");
      picking = true;
      openAt = caret - line.length;
      suggestions = CALLOUT_TYPES.filter((t) => t.startsWith(q)).map((t) => ({
        insert: t,
        label: t,
        what: "callout",
      }));
      highlighted = 0;
      return;
    }
    mode = "link";
    armed = true;
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
    if (mode === "callout") {
      const head = `> [!${s.insert}] `;
      body = body.slice(0, openAt) + head + body.slice(caret);
      picking = false;
      const at = openAt + head.length;
      queueMicrotask(() => {
        el.focus();
        el.setSelectionRange(at, at);
      });
      return;
    }
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
      armed = true;
      highlighted = (highlighted + 1) % suggestions.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      armed = true;
      highlighted = (highlighted - 1 + suggestions.length) % suggestions.length;
    } else if (e.key === "Enter" && !armed) {
      picking = false;
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

  let loadError = $state<string | null>(null);

  onMount(async () => {
    try {
      const [cats, comps] = await Promise.all([
        api.get<WikiCategory[]>(`/library/wiki/${scope}/categories`),
        hasComponents
          ? api.get<ComponentRow[]>(`/products/${scope}/components`)
          : Promise.resolve([] as ComponentRow[]),
      ]);
      categories = cats;
      components = comps;
      if (seed?.component_id)
        component =
          comps.find((c) => c.id === seed.component_id)?.slug ?? "";
    } catch (e) {
      loadError = errText(e);
    }
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

{#snippet formActions()}
  <FormActions form="wiki-form" {saving} title={editing ? "save changes" : "create article"} create={!editing} oncancel={onCancel} />
{/snippet}

<form id="wiki-form" class="article-form" onsubmit={submit}>
  <div class="head">
    <div class="grow">
      <Field label="title" required>
        <input bind:value={title} required />
      </Field>
    </div>
    <Field
      label="slug"
      required
      info={editing
        ? "The article's address. Renaming it rewrites [[links]] to it, and the old address keeps working."
        : "The article's address, and what [[links]] to it use."}
    >
      <input
        bind:value={slug}
        oninput={() => (slugTouched = true)}
        required
      />
    </Field>
    <Field label="status">
      <AsciiSelect bind:value={status} options={[...REFERENCE_STATUSES]} />
    </Field>
    {#if hasComponents}
      <Field
        label="about"
        info="Product part covered. Used by coverage and gap sweep."
      >
        <AsciiSelect
          bind:value={component}
          disabled={components.length === 0}
          options={[
            { value: "", label: "the whole product" },
            ...componentOptions(components),
          ]}
        />
      </Field>
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

  {#if error ?? loadError}<Note tone="danger">{error ?? loadError}</Note>{/if}
  {#if uploadError}<Note tone="warn">{uploadError}</Note>{/if}

  <div class="split" class:solo={!preview}>
    <div class="bar">
      <Button
        variant="ghost"
        size="sm"
        icon={preview ? "eyeClosed" : "eye"}
      morph
        title={preview ? "hide preview" : "show preview"}
        aria-label={preview ? "hide preview" : "show preview"}
        onclick={() => (preview = !preview)}
      />
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -- a drop target
         for images, beside the textarea that is the real control -->
    <div class="editwrap" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
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

    {#if preview}
      <div class="pane md" aria-label="preview">{@html rendered}</div>
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
  .lbl {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted);
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
  }
  .cats .picker {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 0.8rem;
    margin-top: 0.2rem;
    font-size: var(--fs-xs);
  }
  .cat {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.3rem;
    margin-left: calc(var(--depth) * 0.8rem);
  }
  /* The editor is the point of this form, so it takes the height. Body and
     preview share the second row so they are always the same height; the
     toggle sits over the preview, or over the body's right edge without one. */
  .split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr;
    gap: var(--pad-1) var(--pad-2);
    flex: 1;
    min-height: 24rem;
  }
  .split.solo {
    grid-template-columns: 1fr;
  }
  .bar {
    grid-column: 2;
    justify-self: start;
  }
  .split.solo .bar {
    grid-column: 1;
    justify-self: end;
  }
  .editwrap {
    grid-row: 2;
    grid-column: 1;
    position: relative;
    display: flex;
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
  .pane {
    grid-row: 2;
    grid-column: 2;
    min-height: 0;
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
      grid-template-rows: auto;
      grid-auto-rows: minmax(22rem, 1fr);
    }
    .split .bar {
      grid-column: 1;
      justify-self: end;
    }
    .pane {
      grid-row: 3;
      grid-column: 1;
    }
  }
</style>
