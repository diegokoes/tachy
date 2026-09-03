<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { api } from "../api";
  import { Button, Checkbox } from "../tui";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { renderMarkdown } from "../markdown";
  import { outline } from "../outline";
  import { REFERENCE_STATUSES } from "../vocab";
  import type {
    KnowledgeRow,
    ReferenceRow,
    WikiArticleRef,
    WikiCategory,
    WikiToc,
    WikiTocNode,
  } from "../types";

  let {
    scope,
    initial = null,
    saving = false,
    error = null,
    onSubmit,
    onCancel,
  }: {
    scope: string;
    initial?: ReferenceRow | null;
    saving?: boolean;
    error?: string | null;
    onSubmit: (payload: Record<string, unknown>) => void;
    onCancel: () => void;
  } = $props();

  const seed = untrack(() => initial);
  const editing = !!seed;

  let title = $state(seed?.title ?? "");
  let slug = $state(seed?.slug ?? "");
  let body = $state(seed?.body ?? "");
  let status = $state(seed?.status ?? "approved");
  let chosen = $state<string[]>((seed?.categories ?? []).map((c) => c.slug));

  let categories = $state<WikiCategory[]>([]);
  let preview = $state(true);

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

  /** The outline the reader will get, shown live so structure is visible. */
  const items = $derived(outline(body));

  onMount(async () => {
    try {
      categories = await api.get<WikiCategory[]>(
        `/library/wiki/${scope}/categories`,
      );
    } catch {
      categories = [];
    }
    await loadArticles();
  });

  /** Suggest a slug from the title, but only while creating and untouched. */
  let slugTouched = $state(false);
  $effect(() => {
    if (editing || slugTouched) return;
    const t = title;
    slug = t
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60);
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

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!title.trim() || !slug.trim()) return;
    onSubmit({
      title: title.trim(),
      slug: slug.trim(),
      body,
      status,
      categories: chosen,
      ...(editing ? { expectedVersion: seed!.version } : {}),
    });
  }
</script>

<form class="article-form" onsubmit={submit}>
  <div class="head">
    <label class="grow">
      title
      <input bind:value={title} placeholder="Printing subsystem" required />
    </label>
    <label>
      slug
      <input
        bind:value={slug}
        oninput={() => (slugTouched = true)}
        placeholder="printing-subsystem"
        required
      />
    </label>
    <label>
      status
      <AsciiSelect bind:value={status} options={[...REFERENCE_STATUSES]} />
    </label>
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

  <div class="split" class:solo={!preview}>
    <label class="editor">
      <span class="lbl">
        body
        <button type="button" class="toggle" onclick={() => (preview = !preview)}>
          {preview ? "hide preview" : "show preview"}
        </button>
      </span>
      <div class="editwrap">
        <textarea
          bind:this={bodyEl}
          bind:value={body}
          spellcheck="false"
          oninput={syncPicker}
          onkeydown={onBodyKeydown}
          onclick={syncPicker}
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
    </label>

    {#if preview}
      <div class="preview">
        <span class="lbl">preview</span>
        <div class="pane">
          {#if items.length > 1}
            <nav class="contents">
              <strong>Contents</strong>
              <ol>
                {#each items as it}
                  <li style="--depth: {Math.max(0, it.depth - 1)}">{it.text}</li>
                {/each}
              </ol>
            </nav>
          {/if}
          <div class="md">{@html renderMarkdown(body)}</div>
        </div>
      </div>
    {/if}
  </div>

  {#if error}<p class="err">{error}</p>{/if}

  <div class="acts">
    <Button variant="ghost" onclick={onCancel} type="button">cancel</Button>
    <Button variant="primary" type="submit" busy={saving}>
      {editing ? "save changes" : "create article"}
    </Button>
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
    gap: var(--pad-2);
    align-items: flex-end;
  }
  .grow {
    flex: 1;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .lbl {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    opacity: 0.7;
    font-size: 0.85em;
  }
  .toggle {
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    opacity: 0.8;
    cursor: pointer;
    text-decoration: underline;
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
    border: 1px solid var(--line, currentColor);
    padding: 0.6rem 0.8rem;
  }
  .contents {
    border: 1px solid var(--line, currentColor);
    padding: 0.4rem 0.8rem;
    margin-bottom: 0.8rem;
    font-size: 0.9em;
  }
  .contents ol {
    margin: 0.2rem 0 0;
    padding: 0;
    list-style: none;
  }
  .contents li {
    padding-left: calc(var(--depth) * 1.2rem);
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
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

  @media (max-width: 60rem) {
    .split {
      grid-template-columns: 1fr;
    }
  }
</style>
