<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { IndexPreview } from "@tachy/contract";
  import { api } from "../../api";
  import { csv } from "../../tui/fields";
  import { ComponentCache } from "../../library/filing.svelte";
  import {
    createResource,
    createSequence,
    errText,
  } from "../../resource.svelte";
  import { navigate } from "../../shell/router.svelte";
  import { canCurateScope, isGlobalAdmin } from "../../access/session.svelte";
  import { keep } from "../../shell/kept";
  import { tweenValue } from "../../motion/motion";
  import { setPageActions } from "../pageActions.svelte";
  import { t } from "../../terms";
  import Group from "../../settings/Group.svelte";
  import Row from "../../settings/Row.svelte";
  import Rows from "../../settings/Rows.svelte";
  import {
    Badge,
    Button,
    DeleteButton,
    ErrorMark,
    Icon,
    Meter,
    Note,
    Select,
    Spinner,
    tip,
  } from "../../tui";
  import { INFO } from "../help";
  import type { Customer, Product, Repo, SourceProject } from "../rows";
  import { byBranch, isUrlish, lineCandidates, type Refs } from "./branches";
  import { configOf, draftOf, saveRepo, type RepoDraft } from "./draft";
  import FileTypes from "./FileTypes.svelte";
  import FolderTree from "./FolderTree.svelte";
  import ToggleRow from "./ToggleRow.svelte";

  let { slug }: { slug: string } = $props();

  const LIST = "/admin/integrations/repos";

  const repos = createResource(
    () => api.get<{ repos: Repo[] }>("/repos").then((r) => r.repos),
    [],
  );
  const projects = createResource(
    () => api.get<SourceProject[]>("/source-projects"),
    [],
  );
  const products = createResource(() => api.get<Product[]>("/products"), []);
  const customers = createResource(() => api.get<Customer[]>("/customers"), []);
  const components = new ComponentCache();

  void Promise.all([
    repos.reload(),
    projects.reload(),
    products.reload(),
    customers.reload(),
  ]);

  const repo = $derived(repos.data.find((r) => r.slug === slug) ?? null);
  const found = $derived(Boolean(repo));

  let draft = $state<RepoDraft | null>(null);
  $effect(() => {
    if (found && !draft) untrack(() => (draft = draftOf(repo!)));
  });

  /** Order carries no meaning in these lists, so it cannot make a draft dirty. */
  const norm = (d: RepoDraft) =>
    JSON.stringify({
      ...d,
      lines: [...d.lines].sort(),
      exclude: [...d.exclude].sort(),
      extensions: d.extensions && [...d.extensions].sort(),
    });
  const baseline = $derived(repo ? norm(draftOf(repo)) : "");
  const dirty = $derived(Boolean(draft) && norm(draft!) !== baseline);

  const knowledgeProjects = $derived(projects.data.filter((p) => p.product_id));
  const project = $derived(
    knowledgeProjects.find((p) => p.id === draft?.source_project_id) ?? null,
  );
  const product = $derived(project?.product_slug ?? draft?.product_slug ?? "");
  const myProducts = $derived(
    products.data.filter((p) => canCurateScope({ team_slug: p.team_slug })),
  );
  const canEdit = $derived.by(() => {
    if (!repo) return false;
    const owner = projects.data.find((p) => p.id === repo.source_project_id);
    const team =
      owner?.team_slug ??
      products.data.find((p) => p.slug === repo.product_slug)?.team_slug ??
      null;
    return canCurateScope({ team_slug: team });
  });

  $effect(() => {
    if (product) void components.load(product);
  });

  const working = (status: string) =>
    status === "cloning" || status === "indexing";
  const busy = $derived(
    Boolean(repo?.active_run) ||
      Boolean(repo && working(repo.index_status)) ||
      Boolean(repo?.lines.some((l) => working(l.index_status))),
  );

  let poll: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    if (busy && !poll) poll = setInterval(repos.reload, 3000);
    if (!busy && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  });
  onDestroy(() => poll && clearInterval(poll));

  let refs = $state<(Refs & { url: string }) | null>(null);
  let refsError = $state<string | null>(null);
  let probing = $state(false);
  const url = $derived(draft?.url.trim() ?? "");
  const refsHere = $derived(refs?.url === url ? refs : null);

  async function loadRefs() {
    if (!isUrlish(url)) return;
    const asked = url;
    probing = true;
    refsError = null;
    try {
      const q = new URLSearchParams({ url: asked });
      if (draft?.source_project_id)
        q.set("source_project_id", draft.source_project_id);
      else if (product) q.set("product", product);
      const res = await api.get<
        { ok: boolean; error?: string } & Partial<Refs>
      >(`/repos/refs?${q}`);
      if (!res.ok) throw new Error(res.error ?? "could not list branches");
      refs = {
        url: asked,
        branches: res.branches ?? [],
        releases: res.releases ?? [],
      };
    } catch (e) {
      refsError = errText(e);
    } finally {
      probing = false;
    }
  }

  $effect(() => {
    if (!url || !canEdit) return;
    const timer = setTimeout(() => untrack(loadRefs), 500);
    return () => clearTimeout(timer);
  });

  const branchOptions = $derived(
    [...new Set([draft?.default_branch ?? "", ...(refsHere?.branches ?? [])])]
      .filter(Boolean)
      .sort(byBranch)
      .map((b) => ({ value: b, label: b })),
  );
  const candidates = $derived(
    draft
      ? lineCandidates(
          refsHere?.branches ?? [],
          draft.lines,
          draft.default_branch,
        )
      : [],
  );

  /** Past this many, release lines wait behind a chevron. */
  const FIRST_LINES = 5;
  let allLines = $state(false);

  /* Tracked lines lead, by what is saved rather than by the draft, so a row
     never moves out from under the click that toggled it. */
  const orderedLines = $derived.by(() => {
    const saved = new Set(repo?.lines.map((l) => l.ref) ?? []);
    return [...candidates].sort(
      (a, b) => Number(saved.has(b)) - Number(saved.has(a)) || byBranch(a, b),
    );
  });
  const shownLines = $derived(
    allLines ? orderedLines : orderedLines.slice(0, FIRST_LINES),
  );

  function toggleLine(b: string, on: boolean) {
    if (!draft) return;
    draft.lines = on
      ? [...draft.lines, b].sort(byBranch)
      : draft.lines.filter((l) => l !== b);
  }

  let preview = $state<IndexPreview | null>(null);
  let previewError = $state<string | null>(null);
  const sequence = createSequence();
  const configKey = $derived(draft ? JSON.stringify(configOf(draft)) : "");

  async function count(config: Record<string, unknown>) {
    const current = sequence();
    try {
      const res = await api.post<
        { ok: boolean; error?: string } & Partial<IndexPreview>
      >(`/repos/${slug}/preview`, { config });
      if (!current()) return;
      if (!res.ok) throw new Error(res.error ?? "could not read the files");
      preview = res as IndexPreview;
      previewError = null;
    } catch (e) {
      if (current()) previewError = errText(e);
    }
  }

  /* Recounted as the excludes and types change, so the effect of a toggle is
     on screen before anything is saved. */
  $effect(() => {
    const key = configKey;
    if (!key || !canEdit) return;
    const timer = setTimeout(
      () => void count(JSON.parse(key)),
      untrack(() => (preview ? 400 : 0)),
    );
    return () => clearTimeout(timer);
  });

  /* The tree owns excludes that name one of its folders; the patterns field
     owns everything else, kept as typed while it has focus. */
  const dirSet = $derived(new Set(preview?.dirs.map((x) => x.path) ?? []));
  const patterns = $derived(
    draft?.exclude.filter((p) => !dirSet.has(p)).join(", ") ?? "",
  );
  let patternText = $state("");
  /* The tree's share, taken when typing starts: a half-typed `load/k6`
     passes through `load`, which must not stick as a folder. */
  let treeOwned: string[] | null = null;
  $effect(() => {
    const now = patterns;
    if (!treeOwned) untrack(() => (patternText = now));
  });
  function startTyping() {
    treeOwned = draft?.exclude.filter((p) => dirSet.has(p)) ?? [];
  }
  function stopTyping() {
    treeOwned = null;
    patternText = patterns;
  }
  function setPatterns(text: string) {
    patternText = text;
    if (draft && treeOwned) draft.exclude = [...treeOwned, ...csv(text)];
  }

  let shown = $state(0);
  let counter: ReturnType<typeof tweenValue> = null;
  $effect(() => {
    const to = preview?.files_admitted;
    if (to === undefined) return;
    untrack(() => {
      counter?.kill();
      counter = document.hidden
        ? ((shown = to), null)
        : tweenValue(shown, to, (v) => (shown = Math.round(v)), {
            duration: 0.45,
          });
    });
  });
  onDestroy(() => counter?.kill());

  let saving = $state(false);
  let indexing = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function save() {
    if (!draft) return;
    saving = true;
    error = null;
    try {
      await saveRepo(slug, draft, product);
      await repos.reload();
      if (repo) draft = draftOf(repo);
    } catch (e) {
      error = errText(e);
    } finally {
      saving = false;
    }
  }

  async function reindex(line?: string) {
    indexing = line ?? "*";
    error = null;
    try {
      await api.post(`/repos/${slug}/reindex`, line ? { line } : {});
      await repos.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      indexing = null;
    }
  }

  async function unlink() {
    error = null;
    try {
      await api.delete(`/repos/${slug}`);
      navigate(LIST);
    } catch (e) {
      error = errText(e);
    }
  }

  function showRuns() {
    keep("admin.runs.kind", "repo.reindex");
    navigate("/admin/workers/runs");
  }

  const freshness = (at: string | null) => {
    if (!at) return "never";
    const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
    return days === 0 ? "today" : `${days}d ago`;
  };
  const fmt = (n: number) => n.toLocaleString();
  const tone = (status: string) =>
    status === "ready" ? "ok" : status === "error" ? "danger" : "muted";

  const projectOptions = $derived([
    { value: "", label: `(none, scope by ${t("product")})` },
    ...knowledgeProjects.map((p) => ({
      value: p.id,
      label: p.external_key,
      hint: p.product_slug ?? undefined,
    })),
  ]);
  const productOptions = $derived([
    { value: "", label: "(none)" },
    ...myProducts.map((p) => ({ value: p.slug, label: p.name })),
  ]);
  const componentOptions = $derived([
    { value: "", label: "(none)" },
    ...components.of(product).map((c) => ({ value: c.slug, label: c.name })),
  ]);
  const customerOptions = $derived([
    { value: "", label: "(none, shared)" },
    ...customers.data.map((c) => ({ value: c.slug, label: c.name })),
  ]);

  $effect(() => setPageActions(actions));
</script>

<!-- In admin's top tab: index while nothing is changed, morphing into save
     the moment something is. Leaving the page is how a change is dropped.
     Delete stays on the page; the corner has no room for a third word. -->
{#snippet actions()}
  {#if canEdit && draft}
    <Button
      variant="ghost"
      size="sm"
      icon={dirty ? "save" : "index"}
      morph
      tone={dirty ? "accent" : undefined}
      busy={saving || indexing === "*"}
      disabled={!dirty && busy}
      title={dirty
        ? "save the changes"
        : "clone this repo and re-read its files into the code index"}
      onclick={() => (dirty ? save() : reindex())}
      >{dirty ? "save" : "index"}</Button
    >
  {/if}
{/snippet}

<div class="body">
  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if repos.error}
    <Note tone="danger">{repos.error}</Note>
  {:else if repos.loading && !repo}
    <Spinner />
  {:else if !repo || !draft}
    <Note>
      No repo named {slug}.
      <button class="link" onclick={() => navigate(LIST)}>All repos</button>
    </Note>
  {:else}
    {@const d = draft}
    <div class="layout">
      <div class="wide">
        <Group label="source" icon="source">
          {#snippet action()}
            {#if canEdit}
              <span class="loud">
                <DeleteButton
                  label="unlink repo"
                  text="delete"
                  onclick={unlink}
                />
              </span>
            {/if}
          {/snippet}
          <div class="pairs">
            <Row
              label="project"
              about="Owning project. Its connection supplies clone credentials."
            >
              <Select
                value={d.source_project_id}
                options={projectOptions}
                searchable
                disabled={!canEdit}
                aria-label="project"
                onchange={(v) => (d.source_project_id = String(v ?? ""))}
              />
            </Row>
            {#if !d.source_project_id}
              <Row label={t("product")}>
                <Select
                  value={d.product_slug}
                  options={productOptions}
                  disabled={!canEdit}
                  aria-label={t("product")}
                  onchange={(v) => (d.product_slug = String(v ?? ""))}
                />
              </Row>
            {/if}
            <Row label="component" about={INFO.repoComponent}>
              <Select
                value={d.component_slug}
                options={componentOptions}
                searchable
                disabled={!canEdit}
                aria-label="component"
                onchange={(v) => (d.component_slug = String(v ?? ""))}
              />
            </Row>
            <Row
              label="customer"
              about="Customer addon repos only. Empty: shared code, included in customer-scoped search."
            >
              <Select
                value={d.customer_slug}
                options={customerOptions}
                searchable
                disabled={!canEdit}
                aria-label="customer"
                onchange={(v) => (d.customer_slug = String(v ?? ""))}
              />
            </Row>
            <Row
              label="clone URL"
              about="Cloned with the project connection's token."
            >
              <input
                bind:value={d.url}
                disabled={!canEdit}
                aria-label="clone URL"
                spellcheck="false"
              />
            </Row>
          </div>
        </Group>
      </div>

      <div class="col">
        <Group
          label="branches"
          icon="branch"
          hint={refsHere
            ? `${fmt(refsHere.branches.length)} branches · ${fmt(refsHere.releases.length)} releases on the remote`
            : undefined}
        >
          <Rows>
            <Row
              label="default branch"
              about="Where releases land, usually master. Searched by default."
            >
              {#if refsHere}
                <Select
                  value={d.default_branch}
                  options={branchOptions}
                  searchable
                  disabled={!canEdit}
                  aria-label="default branch"
                  onchange={(v) => (d.default_branch = String(v ?? ""))}
                />
              {:else}
                <input
                  bind:value={d.default_branch}
                  disabled={!canEdit}
                  aria-label="default branch"
                  spellcheck="false"
                />
              {/if}
            </Row>
          </Rows>
          <p
            class="sub"
            use:tip={"A ticket's version is searched on the line for its minor; any release can be read at its tag without one."}
          >
            release lines
          </p>
          {#if probing && !refsHere}
            <p class="quiet">reading branches…</p>
          {:else if refsError && !refsHere}
            <p class="quiet">
              <span class="bad">{refsError}</span>
              <button class="link" onclick={loadRefs}>retry</button>
            </p>
          {/if}
          {#each shownLines as b (b)}
            {@const line = repo.lines.find((l) => l.ref === b)}
            <ToggleRow
              checked={d.lines.includes(b)}
              disabled={!canEdit}
              label={`index ${b}`}
              onchange={(on) => toggleLine(b, on)}
            >
              {#snippet icon()}<Icon name="branch" size="1em" />{/snippet}
              {b}
              {#snippet end()}
                {#if line}
                  {#if line.version_label}<span class="quiet"
                      >{line.version_label}</span
                    >{/if}
                  <Badge tone={tone(line.index_status)}
                    >{line.index_status}</Badge
                  >
                  {#if canEdit && !busy && !dirty}
                    <Button
                      variant="ghost"
                      size="sm"
                      square
                      icon="index"
                      title={`index ${b} only`}
                      aria-label={`index ${b}`}
                      busy={indexing === b}
                      onclick={() => reindex(b)}
                    />
                  {/if}
                {/if}
              {/snippet}
            </ToggleRow>
          {:else}
            {#if refsHere}
              <p class="quiet">no release lines on the remote</p>
            {:else if !probing && !refsError}
              <p class="quiet">listed once the remote's branches are read</p>
            {/if}
          {/each}
          {#if orderedLines.length > FIRST_LINES}
            <button
              class="more"
              aria-expanded={allLines}
              onclick={() => (allLines = !allLines)}
            >
              <span class="chev" class:up={allLines}
                ><Icon name="chevron" size="1em" /></span
              >
              {allLines ? "fewer" : `${orderedLines.length - FIRST_LINES} more`}
            </button>
          {/if}
        </Group>

        <Group label="index" icon="index">
          <Rows>
            {#each repo.lines.filter((l) => l.ref === repo.default_branch) as l (l.id)}
              <Row label="status">
                <span class="inline">
                  {#if l.version_label}<span class="quiet"
                      >{l.version_label}</span
                    >{/if}
                  <Badge tone={tone(l.index_status)}>{l.index_status}</Badge>
                  {#if l.index_error}
                    <ErrorMark
                      message={l.index_error}
                      label={`${l.ref} index`}
                    />
                  {/if}
                </span>
              </Row>
            {/each}
            {#if repo.active_run}
              {@const run = repo.active_run}
              <Row label="running">
                <span class="inline">
                  {#if run.status === "queued"}
                    <span class="quiet"
                      >queued{run.line ? ` · ${run.line}` : ""}</span
                    >
                  {:else}
                    <Meter
                      value={run.progress ?? 0}
                      width={8}
                      label="index progress"
                    />
                    <span class="quiet"
                      >{Math.round(
                        (run.progress ?? 0) * 100,
                      )}%{run.progress_note
                        ? ` · ${run.progress_note}`
                        : ""}</span
                    >
                  {/if}
                  {#if isGlobalAdmin()}
                    <button class="link" onclick={showRuns}>run</button>
                  {/if}
                </span>
              </Row>
            {/if}
            <Row label="last indexed">
              <span class="quiet">{freshness(repo.last_indexed_at)}</span>
            </Row>
            <Row label="in the index">
              <span class="quiet"
                >{fmt(repo.file_count)} files · {fmt(repo.chunk_count)} chunks</span
              >
            </Row>
            <Row label="max file size">
              <span class="inline">
                <input
                  class="kb"
                  type="number"
                  min="1"
                  placeholder="200"
                  bind:value={d.max_file_kb}
                  disabled={!canEdit}
                  aria-label="max file size in KB"
                />
                <span class="quiet">KB</span>
              </span>
            </Row>
          </Rows>
          {#each repo.lines.filter((l) => l.index_error && l.ref !== repo.default_branch) as l (l.id)}
            <ErrorMark message={l.index_error ?? ""} label={`${l.ref} index`} />
          {/each}
        </Group>
      </div>

      <div class="col">
        <Group label="files" icon="folder">
          {#if !canEdit}
            <p class="quiet">Only editors of this repo see its files.</p>
          {:else if previewError && !preview}
            <p class="quiet">
              <span class="bad">{previewError}</span>
              <button class="link" onclick={() => count(configOf(d))}
                >retry</button
              >
            </p>
          {:else if !preview}
            <p class="quiet">reading the tree…</p>
          {:else}
            <p class="sum">
              <strong>{fmt(shown)}</strong>
              <span class="quiet"
                >of {fmt(preview.files_total)} files indexed on</span
              >
              <Icon name="branch" size="1em" />
              <span>{preview.ref}</span>
            </p>
            <FolderTree
              {slug}
              dirs={preview.dirs}
              admitted={preview.files_admitted}
              exclude={d.exclude}
              onchange={(next) => (d.exclude = next)}
            />
            <Rows>
              <Row
                label="patterns"
                about="Paths or globs left out as well, comma separated, such as scripts/**/*.json. Folders are switched off above."
              >
                <input
                  value={patternText}
                  placeholder="scripts/**/*.json"
                  aria-label="exclude patterns"
                  spellcheck="false"
                  onfocus={startTyping}
                  onblur={stopTyping}
                  oninput={(e) => setPatterns(e.currentTarget.value)}
                />
              </Row>
            </Rows>
          {/if}
        </Group>

        {#if canEdit && preview}
          <Group
            label="file types"
            icon="fileTypes"
            hint={d.extensions
              ? "Found in this repo. This repo's own set is on."
              : "Found in this repo. The built-in set is on."}
          >
            {#snippet action()}
              {#if d.extensions}
                <Button
                  variant="ghost"
                  size="sm"
                  square
                  icon="reset"
                  title="back to the built-in set"
                  onclick={() => (d.extensions = null)}
                />
              {/if}
            {/snippet}
            <FileTypes
              types={preview.types}
              extensions={d.extensions}
              onchange={(next) => (d.extensions = next)}
            />
          </Group>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Tighter than settings: these groups hold lists, not a handful of
     controls, and read like the repos table they open from. */
  .body {
    --row-h: 1.5rem;
    --control-w: 16rem;
    padding-top: var(--pad-3);
    padding-inline: var(--view-pad-x);
  }
  /* The repos table's width: source runs across the top, two fields to a
     line, and the lists share the rest in two columns. */
  .layout {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    column-gap: calc(var(--pad-4) * 3);
    row-gap: var(--pad-4);
  }
  .wide {
    grid-column: 1 / -1;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-width: 0;
  }
  .pairs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: calc(var(--pad-4) * 3);
    row-gap: var(--pad-1);
    container-type: inline-size;
  }
  .loud :global(.btn) {
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  @media (max-width: 60rem) {
    .layout,
    .pairs {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .bad {
    color: var(--danger);
    font-size: var(--fs-sm);
  }
  .sub {
    margin: var(--pad-2) 0 var(--pad-1);
    font-size: var(--fs-xs);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
  }
  .quiet {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .inline {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .sum {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0 0 var(--pad-2);
    font-size: var(--fs-sm);
  }
  .sum strong {
    min-width: 3.5ch;
    font-size: var(--fs-md);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  input.kb {
    width: 6rem;
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
    margin-top: var(--pad-1);
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .more:hover,
  .more:focus-visible {
    color: var(--accent);
  }
  .chev {
    display: inline-flex;
    transition: transform 0.16s ease;
  }
  .chev.up {
    transform: rotate(180deg);
  }
  .link {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
