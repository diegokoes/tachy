<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { keep, recall } from "../kept";
  import { api } from "../api";
  import { canCurateScope, isGlobalAdmin } from "../session.svelte";
  import { t } from "../terms";
  import { createResource, errText } from "../resource.svelte";
  import { slugify, uniqueSlug } from "../slug";
  import { ComponentCache } from "../filing.svelte";
  import {
    Badge,
    Button,
    Chip,
    CrudTable,
    FilterBar,
    ErrorMark,
    Field,
    Meter,
    Note,
    type Column,
    type Draft,
  } from "../tui";
  import type { Customer, Product, Repo, SourceProject } from "./rows";
  import { INFO } from "./help";
  import { csv } from "../fields";
  import { DEFAULT_CODE_EXTENSIONS } from "@tachy/contract";
  import {
    claimSectionAction,
    sectionHoist,
    type SectionAction,
  } from "./sectionAction.svelte";
  import { gsap, reducedMotion } from "../gsap";
  import { navigate } from "../router.svelte";

  type FoundRepo = { name: string; url: string; default_branch: string };
  type Refs = { branches: string[]; releases: string[] };
  type Preview = {
    ref: string;
    files_total: number;
    files_admitted: number;
    by_dir: { dir: string; files: number }[];
    by_ext: { ext: string; files: number }[];
  };

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
  let error = $state<string | null>(null);
  let indexing = $state<string | null>(null);
  let indexingAll = $state(false);
  let queuedAll = $state(false);
  let found = $state<Record<string, FoundRepo[]>>({});
  let discovering = $state(false);
  let refs = $state<Record<string, Refs>>({});
  let refsError = $state<Record<string, string>>({});
  let probing = $state<string | null>(null);
  let preview = $state<Record<string, Preview>>({});
  let previewing = $state<string | null>(null);
  let poll: ReturnType<typeof setInterval> | undefined;

  const knowledgeProjects = $derived(projects.data.filter((p) => p.product_id));
  const projectOf = (id: string) =>
    knowledgeProjects.find((p) => p.id === id) ?? null;

  /** A repo is scoped by its project when it has one, else directly by product. */
  const productOfDraft = (d: Draft) =>
    projectOf(String(d.source_project_id ?? ""))?.product_slug ??
    String(d.product_slug ?? "");

  const canEditRepo = (r: Repo) => {
    const project = projects.data.find((p) => p.id === r.source_project_id);
    const team =
      project?.team_slug ??
      products.data.find((p) => p.slug === r.product_slug)?.team_slug ??
      null;
    return canCurateScope({ team_slug: team });
  };
  const myProducts = $derived(
    products.data.filter((p) => canCurateScope({ team_slug: p.team_slug })),
  );
  const canAdd = $derived(myProducts.length > 0);
  const working = (status: string) =>
    status === "cloning" || status === "indexing";
  const busyRepo = (r: Repo) =>
    Boolean(r.active_run) ||
    working(r.index_status) ||
    r.lines.some((l) => working(l.index_status));
  const busyIndex = $derived(repos.data.some(busyRepo) || queuedAll);

  const MAINLINE = ["master", "main", "develop", "quality"];
  const RELEASE_LINE_RE = /^(legacy|release)\//;
  const branchRank = (b: string) =>
    MAINLINE.includes(b) ? 0 : RELEASE_LINE_RE.test(b) ? 1 : 2;
  /** Mainline in its usual order, then release lines newest first, then the rest. */
  const byBranch = (a: string, b: string) =>
    branchRank(a) - branchRank(b) ||
    (branchRank(a) === 0
      ? MAINLINE.indexOf(a) - MAINLINE.indexOf(b)
      : branchRank(a) === 1
        ? b.localeCompare(a, undefined, { numeric: true })
        : a.localeCompare(b));

  const refsFor = (d: Draft): Refs | null => refs[String(d.url ?? "")] ?? null;

  function branchOptions(d: Draft) {
    const current = String(d.default_branch ?? "");
    return [...new Set([current, ...(refsFor(d)?.branches ?? [])])]
      .filter(Boolean)
      .sort(byBranch)
      .map((b) => ({ value: b, label: b }));
  }

  /** Branches worth offering as extra lines: mainline and release lines. */
  function lineCandidates(d: Draft): string[] {
    const chosen = csv(String(d.lines ?? ""));
    const offered = (refsFor(d)?.branches ?? []).filter(
      (b) => branchRank(b) < 2,
    );
    return [...new Set([...chosen, ...offered])]
      .filter((b) => b !== String(d.default_branch ?? ""))
      .sort(byBranch);
  }

  const URLISH_RE = /^(https?:\/\/|ssh:\/\/|git@)\S+$/;

  async function loadRefs(url: string, projectId: string, product: string) {
    if (!URLISH_RE.test(url) || refs[url] || probing === url) return;
    probing = url;
    try {
      const q = new URLSearchParams({ url });
      if (projectId) q.set("source_project_id", projectId);
      else if (product) q.set("product", product);
      const res = await api.get<
        { ok: boolean; error?: string } & Partial<Refs>
      >(`/repos/refs?${q}`);
      if (!res.ok) throw new Error(res.error ?? "could not list branches");
      refs[url] = {
        branches: res.branches ?? [],
        releases: res.releases ?? [],
      };
      delete refsError[url];
    } catch (e) {
      refsError[url] = errText(e);
    } finally {
      if (probing === url) probing = null;
    }
  }

  /** Lists the remote's branches as the form's URL settles. */
  function autoRefs(
    _node: HTMLElement,
    p: { url: string; projectId: string; product: string },
  ) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kick = (next: typeof p) => {
      clearTimeout(timer);
      timer = setTimeout(
        () => void loadRefs(next.url, next.projectId, next.product),
        500,
      );
    };
    kick(p);
    return { update: kick, destroy: () => clearTimeout(timer) };
  }

  async function runPreview(slug: string, d: Draft) {
    previewing = slug;
    error = null;
    try {
      const res = await api.post<
        { ok: boolean; error?: string } & Partial<Preview>
      >(`/repos/${slug}/preview`, { config: configOf(d) });
      if (!res.ok) throw new Error(res.error ?? "preview failed");
      preview[slug] = res as Preview;
    } catch (e) {
      error = errText(e);
    } finally {
      previewing = null;
    }
  }

  function toggleExclude(d: Draft, dir: string) {
    const current = csv(String(d.exclude ?? ""));
    d.exclude = (
      current.includes(dir)
        ? current.filter((p) => p !== dir)
        : [...current, dir]
    ).join(", ");
  }

  const extensionsOf = (r: Repo): string[] =>
    Array.isArray(r.config?.include_extensions)
      ? (r.config.include_extensions as string[])
      : [];

  const freshness = (r: Repo) => {
    if (!r.last_indexed_at) return "never";
    const days = Math.floor(
      (Date.now() - new Date(r.last_indexed_at).getTime()) / 86_400_000,
    );
    return days === 0 ? "today" : `${days}d ago`;
  };

  async function reload() {
    await Promise.all([
      repos.reload(),
      projects.reload(),
      products.reload(),
      customers.reload(),
    ]);
  }

  /* An Azure DevOps project routinely holds fifty repos, and the form here is
     one dialog each; bulk linking has a page of its own. */
  const canBulk = $derived(
    knowledgeProjects.some((p) => canCurateScope({ team_slug: p.team_slug })),
  );

  /** The section steps out of the way before the orbit takes the window. */
  async function bulkLink() {
    const section = document.getElementById("admin-repos");
    if (section && !reducedMotion())
      await gsap.to(section, {
        opacity: 0,
        y: -8,
        duration: 0.28,
        ease: "power2.in",
      });
    navigate("/admin/integrations/bulk-link");
  }

  const bulkAction: SectionAction = {
    label: "bulk link",
    icon: "bulk",
    tone: "info",
    run: bulkLink,
  };

  $effect(() => {
    if (canBulk) return claimSectionAction("repos", bulkAction, "aside");
  });

  /** Repos of the chosen project, so the clone URL is picked, not transcribed. */
  async function discover(d: Draft) {
    const p = projectOf(String(d.source_project_id ?? ""));
    if (!p) return;
    discovering = true;
    error = null;
    try {
      const res = await api.get<{
        ok: boolean;
        error?: string;
        repos?: FoundRepo[];
      }>(
        `/source-connections/${p.source_slug}/discover/repos?project=${encodeURIComponent(p.external_key)}`,
      );
      if (!res.ok) throw new Error(res.error ?? "discovery failed");
      found[p.id] = res.repos ?? [];
    } catch (e) {
      error = errText(e);
    } finally {
      discovering = false;
    }
  }

  const columns: Column<Repo>[] = $derived([
    {
      key: "slug",
      label: "repo",
      edit: "text",
      required: true,
      editable: () => false,
      info: INFO.slug,
      cell: repoCell,
      derive: (d) =>
        uniqueSlug(
          slugify(
            String(d.url ?? "")
              .replace(/\.git$/, "")
              .split("/")
              .filter(Boolean)
              .pop() ?? "",
          ),
          repos.data.map((r) => r.slug),
        ),
    },
    {
      key: "url",
      label: "clone URL",
      formOnly: true,
      edit: "text",
      required: true,
      info: "Cloned with the project connection's token.",
    },
    {
      key: "source_project_id",
      label: "project",
      width: "13rem",
      edit: "select",
      info: "Owning project. Its connection supplies clone credentials.",
      options: [
        { value: "", label: `(none, scope by ${t("product")})` },
        ...knowledgeProjects.map((p) => ({
          value: p.id,
          label: `${p.external_key} (${p.product_slug})`,
        })),
      ],
      // The id, because that is what the options carry and what the API takes;
      // the table shows project_key through `cell`.
      value: (r) => r.source_project_id ?? "",
      cell: projectCell,
    },
    {
      key: "product_slug",
      label: t("product"),
      formOnly: true,
      edit: "select",
      info: "Only without a project.",
      options: [
        { value: "", label: "(from the project)" },
        ...myProducts.map((p) => ({ value: p.slug, label: p.name })),
      ],
    },
    {
      key: "customer_slug",
      label: "customer",
      width: "10rem",
      edit: "select",
      info: "Customer addon repos only. Empty: shared code, included in customer-scoped search.",
      options: [
        { value: "", label: "(none, shared)" },
        ...customers.data.map((cu) => ({ value: cu.slug, label: cu.name })),
      ],
    },
    {
      key: "component_slug",
      label: "component",
      width: "10rem",
      edit: "select",
      info: INFO.repoComponent,
      options: (d) => [
        { value: "", label: "(none)" },
        ...components.of(productOfDraft(d)).map((c) => ({
          value: c.slug,
          label: c.name,
        })),
      ],
    },
    {
      key: "default_branch",
      label: "branch",
      width: "8rem",
      edit: "text",
      initial: "main",
      visible: (d) => !refsFor(d),
      info: "Where releases land, usually master. Becomes a list once the remote's branches are read.",
    },
    {
      key: "default_branch",
      label: "branch",
      formOnly: true,
      edit: "select",
      searchable: true,
      visible: (d) => Boolean(refsFor(d)),
      options: branchOptions,
      info: "Where releases land, usually master. Searched by default; older release lines are added below.",
    },
    {
      key: "lines",
      label: "lines",
      formOnly: true,
      edit: "text",
      /* Edited by the line chips below the form, like the file types. */
      visible: () => false,
      value: (r) =>
        r.lines
          .filter((l) => l.ref !== r.default_branch)
          .map((l) => l.ref)
          .join(", "),
    },
    {
      key: "exclude",
      label: "exclude",
      formOnly: true,
      edit: "text",
      placeholder: "other/application/bopools, scripts/**/*.json",
      info: "Paths or globs left out of the index. A path excludes everything under it.",
      value: (r) =>
        Array.isArray(r.config?.exclude)
          ? (r.config.exclude as string[]).join(", ")
          : "",
    },
    {
      key: "extensions",
      label: "file types",
      formOnly: true,
      edit: "text",
      /* The draft still carries it (`visible` only hides the input) because
         the chip picker below the form is what edits this one. */
      visible: () => false,
      value: (r) => extensionsOf(r).join(", "),
    },
    {
      key: "max_file_kb",
      label: "max file KB",
      formOnly: true,
      edit: "text",
      info: "Larger files skipped. Default 200.",
      value: (r) => r.config?.max_file_kb ?? "",
    },
    { key: "index_status", label: "index", width: "13rem", cell: indexCell },
    { key: "indexed", label: "indexed", width: "10rem", cell: freshnessCell },
  ]);

  function configOf(d: Draft): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    const ext = csv(String(d.extensions ?? ""));
    if (ext.length) config.include_extensions = ext;
    if (String(d.max_file_kb ?? "").trim())
      config.max_file_kb = Number(d.max_file_kb);
    const exclude = csv(String(d.exclude ?? ""));
    if (exclude.length) config.exclude = exclude;
    return config;
  }

  async function save(d: Draft) {
    const config = configOf(d);
    const product = productOfDraft(d);
    await api.put("/repos", {
      slug: String(d.slug).trim(),
      url: String(d.url).trim(),
      ...(d.source_project_id
        ? { source_project_id: d.source_project_id }
        : {}),
      ...(product ? { product } : {}),
      component: d.component_slug || null,
      customer: d.customer_slug || null,
      branch: String(d.default_branch ?? "").trim() || "main",
      lines: csv(String(d.lines ?? "")),
      config,
    });
  }

  async function reindex(r: Repo, line?: string) {
    indexing = line ? `${r.slug}:${line}` : r.slug;
    error = null;
    try {
      await api.post(`/repos/${r.slug}/reindex`, line ? { line } : {});
      await repos.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      indexing = null;
    }
  }

  async function reindexAll() {
    indexingAll = true;
    error = null;
    try {
      await api.post("/repos/reindex", {});
      queuedAll = true;
      setTimeout(() => (queuedAll = false), 10_000);
      await repos.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      indexingAll = false;
    }
  }

  function showRuns() {
    keep("admin.runs.kind", "repo.reindex");
    navigate("/admin/workers/runs");
  }

  // Indexing runs in the background on the server, so the table follows it.
  $effect(() => {
    if (busyIndex && !poll) poll = setInterval(repos.reload, 3000);
    if (!busyIndex && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  });

  // The component picker switches product as the form's project changes, so
  // every curatable product's components are on hand before the form opens.
  $effect(() => {
    for (const p of myProducts) void components.load(p.slug);
  });

  onDestroy(() => poll && clearInterval(poll));
  onMount(reload);

  let filter = $state(recall("admin.repos.filter", ""));
  $effect(() => keep("admin.repos.filter", filter));
  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos.data;
    return repos.data.filter((r) =>
      [
        r.slug ?? "",
        r.url ?? "",
        r.product_slug ?? "",
        r.component_slug ?? "",
        r.project_key ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  });
</script>

{#snippet projectCell(r: Repo)}
  <span class:dim={!r.project_key}>{r.project_key ?? "-"}</span>
{/snippet}

{#snippet repoCell(r: Repo)}
  <span class="repo">
    {r.slug}
    <span class="url">{r.url}</span>
  </span>
{/snippet}

{#snippet statusBadge(status: string)}
  <Badge
    tone={status === "ready" ? "ok" : status === "error" ? "danger" : "muted"}
    >{status}</Badge
  >
{/snippet}

{#snippet indexCell(r: Repo)}
  {#if r.lines.length}
    <span class="lines">
      {#each r.lines as l (l.id)}
        <span class="line" title={l.ref}>
          {@render statusBadge(l.index_status)}
          {#if r.lines.length > 1}<span class="ref">{l.ref}</span>{/if}
          {#if l.version_label}<span class="ver">{l.version_label}</span>{/if}
          {#if r.lines.length > 1 && canEditRepo(r) && !busyRepo(r)}
            <Button
              variant="ghost"
              size="sm"
              square
              icon="index"
              title={`index ${l.ref} only`}
              aria-label={`index ${r.slug} ${l.ref}`}
              busy={indexing === `${r.slug}:${l.ref}`}
              onclick={() => reindex(r, l.ref)}
            />
          {/if}
        </span>
      {/each}
    </span>
  {:else}
    {@render statusBadge(r.index_status)}
  {/if}
  {#if r.active_run}
    {@const run = r.active_run}
    <span class="run">
      {#if run.status === "queued"}
        <Badge tone="muted">queued</Badge>
        <span class="sm"
          >waiting in the index queue{run.line ? ` · ${run.line}` : ""}</span
        >
      {:else}
        <Meter value={run.progress ?? 0} width={8} label="index progress" />
        <span class="sm"
          >{Math.round((run.progress ?? 0) * 100)}%{run.progress_note
            ? ` · ${run.progress_note}`
            : ""}</span
        >
      {/if}
      {#if isGlobalAdmin()}
        <button class="link sm" onclick={showRuns}>run</button>
      {/if}
    </span>
  {/if}
{/snippet}

{#snippet freshnessCell(r: Repo)}
  <span class="fresh">
    {freshness(r)}
    {#if r.file_count}
      <span class="counts">{r.file_count} files / {r.chunk_count} chunks</span>
    {/if}
  </span>
{/snippet}

{#snippet reindexAction(r: Repo)}
  {#if canEditRepo(r)}
    <Button
      variant="ghost"
      size="sm"
      icon="index"
      title="clone this repo and re-read its files into the code index"
      busy={indexing === r.slug}
      disabled={busyRepo(r)}
      onclick={() => reindex(r)}>index</Button
    >
  {/if}
{/snippet}

{#snippet indexErrors()}
  {#each repos.data as r (r.id)}
    {#each r.lines.filter((l) => l.index_error) as l (l.id)}
      <ErrorMark
        message={l.index_error ?? ""}
        label={`${r.slug} ${l.ref} index`}
      />
    {/each}
  {/each}
{/snippet}

<!-- Two different verbs, kept apart on purpose. Finding asks the source what
     repos exist and writes nothing; indexing clones one we already linked and
     reads its files. They used to share a magnifier and a vocabulary. -->
{#snippet formExtra(f: {
  mode: "create" | "edit";
  row: Repo | null;
  draft: Draft;
})}
  {@const project = projectOf(String(f.draft.source_project_id ?? ""))}
  {@const hits = project ? (found[project.id] ?? []) : []}
  {#if project && f.mode === "create"}
    <div class="find">
      <Field
        label="find a repo"
        info="Ask the project's connection what it holds, instead of pasting a clone URL."
        plain
      >
        <Button
          variant="ghost"
          size="sm"
          icon="discover"
          busy={discovering}
          onclick={() => discover(f.draft)}>ask {project.external_key}</Button
        >
      </Field>
      {#if hits.length}
        <div class="chips">
          {#each hits as r (r.name)}
            <Chip
              tone={f.draft.url === r.url ? "accent" : "default"}
              title={r.url}
              onclick={() => {
                f.draft.url = r.url;
                if (r.default_branch) f.draft.default_branch = r.default_branch;
              }}>{r.name}</Chip
            >
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {@const url = String(f.draft.url ?? "")}
  {@const candidates = lineCandidates(f.draft)}
  {@const tracked = new Set(csv(String(f.draft.lines ?? "")))}
  <div
    class="find"
    use:autoRefs={{
      url,
      projectId: String(f.draft.source_project_id ?? ""),
      product: productOfDraft(f.draft),
    }}
  >
    <Field
      label="release lines"
      info="Older branches to index as well, such as legacy/master-1-50. A ticket's version is searched on the line for its minor; any release can be read at its tag without one."
      plain
    >
      {#if probing === url}
        <span class="dim sm">reading branches…</span>
      {:else if refsError[url]}
        <Button
          variant="ghost"
          size="sm"
          icon="discover"
          title={refsError[url]}
          onclick={() => {
            delete refsError[url];
            void loadRefs(
              url,
              String(f.draft.source_project_id ?? ""),
              productOfDraft(f.draft),
            );
          }}>retry branches</Button
        >
      {:else}
        <span class="dim sm"
          >{tracked.size
            ? `${tracked.size} besides ${f.draft.default_branch || "the default"}`
            : refsFor(f.draft)
              ? `${refsFor(f.draft)?.branches.length} branches, ${refsFor(f.draft)?.releases.length} releases`
              : "none"}</span
        >
      {/if}
    </Field>
    {#if candidates.length}
      <div class="chips">
        {#each candidates as b (b)}
          <Chip
            tone={tracked.has(b) ? "accent" : "default"}
            onclick={() => {
              const next = new Set(tracked);
              if (next.has(b)) next.delete(b);
              else next.add(b);
              f.draft.lines = [...next].sort(byBranch).join(", ");
            }}>{b}</Chip
          >
        {/each}
      </div>
    {/if}
  </div>

  {#if f.mode === "edit" && f.row}
    {@const slug = f.row.slug}
    {@const p = preview[slug]}
    {@const excluded = new Set(csv(String(f.draft.exclude ?? "")))}
    <div class="find">
      <Field
        label="what gets indexed"
        info="Counts the files the file types and excludes above admit on the default line, from the clone's trees. Nothing is embedded. Click a folder to exclude it."
        plain
      >
        <Button
          variant="ghost"
          size="sm"
          icon="discover"
          busy={previewing === slug}
          onclick={() => runPreview(slug, f.draft)}>count files</Button
        >
        {#if p}
          <span class="dim sm"
            >{p.files_admitted} of {p.files_total} files on {p.ref}</span
          >
        {/if}
      </Field>
      {#if p}
        <div class="chips">
          {#each p.by_dir as d (d.dir)}
            <Chip
              tone={excluded.has(d.dir) ? "warn" : "default"}
              title={excluded.has(d.dir) ? "excluded" : "exclude this folder"}
              onclick={() => toggleExclude(f.draft, d.dir)}
              >{d.dir} · {d.files}</Chip
            >
          {/each}
        </div>
        <div class="chips">
          {#each p.by_ext as e (e.ext)}
            <span class="dim sm">.{e.ext} {e.files}</span>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- The allowlist is long and nobody remembers it, so it is offered rather
       than described. Ticked chips are exactly what the field holds. -->
  {@const picked = new Set(csv(String(f.draft.extensions ?? "")))}
  <div class="find">
    <Field label="file types" info="Empty indexes the built-in set." plain>
      <span class="dim sm"
        >{picked.size
          ? `${picked.size} chosen`
          : `all ${DEFAULT_CODE_EXTENSIONS.length} built-in types`}</span
      >
    </Field>
    <div class="chips">
      {#each DEFAULT_CODE_EXTENSIONS as ext (ext)}
        <Chip
          tone={picked.has(ext) ? "accent" : "default"}
          onclick={() => {
            const next = new Set(picked);
            if (next.has(ext)) next.delete(ext);
            else next.add(ext);
            f.draft.extensions = [...next].join(", ");
          }}>{ext}</Chip
        >
      {/each}
      {#if picked.size}
        <Chip tone="warn" onclick={() => (f.draft.extensions = "")}>clear</Chip>
      {/if}
    </div>
  </div>
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}
{@render indexErrors()}

<div class="bar">
  <FilterBar
    bind:value={filter}
    shown={filtered.length}
    total={repos.data.length}
    placeholder="filter repos…"
    label="filter repositories"
  />
  {#if isGlobalAdmin() && repos.data.length}
    <Button
      variant="ghost"
      size="sm"
      icon="index"
      title="queue a reindex of every linked repo, including ones never indexed; one at a time, after any you start by hand"
      busy={indexingAll}
      disabled={indexingAll}
      onclick={reindexAll}>index all</Button
    >
  {/if}
</div>
{#if queuedAll}
  <Note>
    Queued a reindex of every linked repo. They index one at a time; follow them
    here or in <button class="link" onclick={showRuns}>runs</button>.
  </Note>
{/if}

<CrudTable
  hoist={sectionHoist("repos")}
  {columns}
  rows={filtered}
  rowKey={(r) => r.slug}
  loading={repos.loading}
  error={repos.error}
  emptyTitle="No repositories linked yet."
  canEdit={canEditRepo}
  canDelete={canEditRepo}
  canCreate={canAdd}
  addLabel="link repository"
  noun="repo"
  editTitle={(r) => r.slug}
  extraActions={reindexAction}
  {formExtra}
  oncreate={(d) => repos.mutate(() => save(d))}
  onsave={(_row, d) => repos.mutate(() => save(d))}
  ondelete={(r) => repos.mutate(() => api.delete(`/repos/${r.slug}`))}
/>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
  }
  .bar > :global(:first-child) {
    flex: 1;
  }
  .run {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin-top: var(--pad-1);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
    margin-bottom: var(--pad-2);
  }

  /* Spans the form grid: a row of forty chips inside one 15rem column is a
     column of forty chips. */
  .find {
    grid-column: 1 / -1;
    margin-top: var(--pad-2);
  }
  .sm {
    font-size: var(--fs-xs);
  }
  .repo,
  .fresh {
    display: block;
    min-width: 0;
  }
  .fresh {
    color: var(--muted);
  }
  .url {
    display: block;
    font-size: var(--fs-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .counts {
    display: block;
    font-size: var(--fs-xs);
    opacity: 0.7;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: var(--pad-1);
    min-width: 0;
    font-size: var(--fs-xs);
  }
  .ref {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ver {
    color: var(--muted);
    white-space: nowrap;
  }
  .dim {
    color: var(--muted);
  }
</style>
