<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { keep, recall } from "../shell/kept";
  import { api } from "../api";
  import { canCurateScope, isGlobalAdmin } from "../access/session.svelte";
  import { createResource, errText } from "../resource.svelte";
  import {
    Badge,
    Button,
    CrudTable,
    FilterBar,
    ErrorMark,
    Meter,
    Note,
    type Column,
  } from "../tui";
  import type { Product } from "../catalog/rows";
  import type { Repo } from "./rows";
  import type { SourceProject } from "../sources/rows";
  import {
    claimSectionAction,
    sectionHoist,
    type SectionAction,
  } from "../admin/sectionAction.svelte";
  import { gsap, reducedMotion } from "../motion/gsap";
  import { navigate } from "../shell/router.svelte";

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

  let error = $state<string | null>(null);
  let indexing = $state<string | null>(null);
  let indexingAll = $state(false);
  let queuedAll = $state(false);
  let poll: ReturnType<typeof setInterval> | undefined;

  const knowledgeProjects = $derived(projects.data.filter((p) => p.product_id));

  const canEditRepo = (repo: Repo) => {
    const project = projects.data.find((p) => p.id === repo.source_project_id);
    const team =
      project?.team_slug ??
      products.data.find((p) => p.slug === repo.product_slug)?.team_slug ??
      null;
    return canCurateScope({ team_slug: team });
  };
  const canAdd = $derived(
    products.data.some((p) => canCurateScope({ team_slug: p.team_slug })),
  );
  const working = (status: string) =>
    status === "cloning" || status === "indexing";
  const busyRepo = (r: Repo) =>
    Boolean(r.active_run) ||
    working(r.index_status) ||
    r.lines.some((l) => working(l.index_status));
  const busyIndex = $derived(repos.data.some(busyRepo) || queuedAll);

  const freshness = (repo: Repo) => {
    if (!repo.last_indexed_at) return "never";
    const days = Math.floor(
      (Date.now() - new Date(repo.last_indexed_at).getTime()) / 86_400_000,
    );
    return days === 0 ? "today" : `${days}d ago`;
  };

  async function reload() {
    await Promise.all([repos.reload(), projects.reload(), products.reload()]);
  }

  // An Azure DevOps project can hold dozens of repos, and the link page is one
  // repo at a time; bulk linking has a page of its own.
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

  const columns: Column<Repo>[] = [
    { key: "slug", label: "repo", cell: repoCell },
    {
      key: "source_project_id",
      label: "project",
      width: "13rem",
      cell: projectCell,
    },
    { key: "customer_slug", label: "customer", width: "10rem" },
    { key: "component_slug", label: "component", width: "10rem" },
    { key: "index_status", label: "index", width: "13rem", cell: indexCell },
    { key: "indexed", label: "indexed", width: "10rem", cell: freshnessCell },
  ];

  async function reindex(repo: Repo, line?: string) {
    indexing = line ? `${repo.slug}:${line}` : repo.slug;
    error = null;
    try {
      await api.post(`/repos/${repo.slug}/reindex`, line ? { line } : {});
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

  onDestroy(() => poll && clearInterval(poll));
  onMount(reload);

  let filter = $state(recall("admin.repos.filter", ""));
  $effect(() => keep("admin.repos.filter", filter));
  const filtered = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return repos.data;
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
        .includes(needle),
    );
  });
</script>

{#snippet projectCell(repo: Repo)}
  <span class:dim={!repo.project_key}>{repo.project_key ?? "-"}</span>
{/snippet}

{#snippet repoCell(repo: Repo)}
  <span class="repo">
    {repo.slug}
    <span class="url">{repo.url}</span>
  </span>
{/snippet}

{#snippet statusBadge(status: string)}
  <Badge
    tone={status === "ready" ? "ok" : status === "error" ? "danger" : "muted"}
    >{status}</Badge
  >
{/snippet}

{#snippet indexCell(repo: Repo)}
  {#if repo.lines.length}
    <span class="lines">
      {#each repo.lines as line (line.id)}
        <span class="line">
          {@render statusBadge(line.index_status)}
          {#if repo.lines.length > 1}<span class="ref">{line.ref}</span>{/if}
          {#if line.version_label}<span class="ver">{line.version_label}</span
            >{/if}
          {#if repo.lines.length > 1 && canEditRepo(repo) && !busyRepo(repo)}
            <Button
              variant="ghost"
              size="sm"
              square
              icon="index"
              title={`index ${line.ref} only`}
              aria-label={`index ${repo.slug} ${line.ref}`}
              busy={indexing === `${repo.slug}:${line.ref}`}
              onclick={() => reindex(repo, line.ref)}
            />
          {/if}
        </span>
      {/each}
    </span>
  {:else}
    {@render statusBadge(repo.index_status)}
  {/if}
  {#if repo.active_run}
    {@const run = repo.active_run}
    <span class="run">
      {#if run.status === "queued"}
        <Badge tone="muted">queued</Badge>
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

{#snippet freshnessCell(repo: Repo)}
  <span class="fresh">
    {freshness(repo)}
    {#if repo.file_count}
      <span class="counts"
        >{repo.file_count} files / {repo.chunk_count} chunks</span
      >
    {/if}
  </span>
{/snippet}

{#snippet reindexAction(repo: Repo)}
  {#if canEditRepo(repo)}
    <Button
      variant="ghost"
      size="sm"
      icon="index"
      busy={indexing === repo.slug}
      disabled={busyRepo(repo)}
      onclick={() => reindex(repo)}>index</Button
    >
  {/if}
{/snippet}

{#snippet indexErrors()}
  {#each repos.data as repo (repo.id)}
    {#each repo.lines.filter((l) => l.index_error) as line (line.id)}
      <ErrorMark
        message={line.index_error ?? ""}
        label={`${repo.slug} ${line.ref} index`}
      />
    {/each}
  {/each}
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}
{@render indexErrors()}

<div class="bar">
  <FilterBar
    bind:value={filter}
    shown={filtered.length}
    total={repos.data.length}
    label="filter repositories"
  />
  {#if isGlobalAdmin() && repos.data.length}
    <Button
      variant="ghost"
      size="sm"
      icon="index"
      busy={indexingAll}
      disabled={indexingAll}
      onclick={reindexAll}>index all</Button
    >
  {/if}
</div>
{#if queuedAll}
  <Note>
    Every linked repo queued. <button class="link" onclick={showRuns}
      >runs</button
    >
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
  canCreate={canAdd}
  addLabel="link repository"
  noun="repo"
  extraActions={reindexAction}
  onopen={(r) => navigate(`${LIST}/${r.slug}`)}
  onadd={() => navigate(`${LIST}/new`)}
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
