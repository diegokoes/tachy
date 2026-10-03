<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { keep, recall } from "../../kept";
  import { api } from "../../api";
  import { canCurateScope, isGlobalAdmin } from "../../session.svelte";
  import { createResource, errText } from "../../resource.svelte";
  import {
    Badge,
    Button,
    CrudTable,
    FilterBar,
    ErrorMark,
    Meter,
    Note,
    type Column,
  } from "../../tui";
  import type { Product, Repo, SourceProject } from "../rows";
  import {
    claimSectionAction,
    sectionHoist,
    type SectionAction,
  } from "../sectionAction.svelte";
  import { gsap, reducedMotion } from "../../gsap";
  import { navigate } from "../../router.svelte";

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

  const canEditRepo = (r: Repo) => {
    const project = projects.data.find((p) => p.id === r.source_project_id);
    const team =
      project?.team_slug ??
      products.data.find((p) => p.slug === r.product_slug)?.team_slug ??
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

  const freshness = (r: Repo) => {
    if (!r.last_indexed_at) return "never";
    const days = Math.floor(
      (Date.now() - new Date(r.last_indexed_at).getTime()) / 86_400_000,
    );
    return days === 0 ? "today" : `${days}d ago`;
  };

  async function reload() {
    await Promise.all([repos.reload(), projects.reload(), products.reload()]);
  }

  /* An Azure DevOps project routinely holds fifty repos, and the link page is
     one repo at a time; bulk linking has a page of its own. */
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
