<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { Badge, Meter, Note, Panel, G, RAMP } from "../tui";
  import SourcesPanel from "./SourcesPanel.svelte";
  import ProjectsPanel from "./ProjectsPanel.svelte";
  import ReposPanel from "./ReposPanel.svelte";
  import type { Connection, Repo, SourceProject } from "./shared";

  const conns = createResource(
    () => api.get<Connection[]>("/source-connections"),
    [],
  );
  const projects = createResource(
    () => api.get<SourceProject[]>("/source-projects"),
    [],
  );
  const repos = createResource(
    () => api.get<{ repos: Repo[] }>("/repos").then((r) => r.repos),
    [],
  );

  const admin = $derived(isGlobalAdmin());

  const knowledge = $derived(
    projects.data.filter((p) => p.role === "knowledge"),
  );
  const noWiki = $derived(
    knowledge.filter(
      (p) => p.source_type === "azure-devops" && !(p.wikis ?? []).length,
    ).length,
  );
  const ready = $derived(
    repos.data.filter((r) => r.index_status === "ready").length,
  );
  const failing = $derived(
    repos.data.filter((r) => r.index_status === "error").length,
  );
  const unmapped = $derived(repos.data.filter((r) => !r.component_id).length);
  const noToken = $derived(conns.data.filter((c) => !c.token_source).length);

  /** Connections grouped by kind — "2 azure-devops · 1 freshdesk". */
  const byType = $derived(
    Object.entries(
      conns.data.reduce<Record<string, number>>((acc, c) => {
        acc[c.source_type] = (acc[c.source_type] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([k, n]) => `${n} ${k}`)
      .join(" · "),
  );

  const trackers = $derived(projects.data.filter((p) => p.role === "tracker").length);

  const chunks = $derived(repos.data.reduce((n, r) => n + (r.chunk_count ?? 0), 0));
  const files = $derived(repos.data.reduce((n, r) => n + (r.file_count ?? 0), 0));

  /** Oldest successful index — the number that tells you if code answers are stale. */
  const oldest = $derived.by(() => {
    const times = repos.data
      .map((r) => (r.last_indexed_at ? Date.parse(r.last_indexed_at) : NaN))
      .filter((n) => Number.isFinite(n));
    if (!times.length) return null;
    const days = (Date.now() - Math.min(...times)) / 86_400_000;
    return days < 1 ? "today" : `${Math.floor(days)}d ago`;
  });

  onMount(() => {
    conns.reload();
    projects.reload();
    repos.reload();
  });
</script>

{#snippet pending()}
  <span class="stat pending" aria-label="loading">{RAMP[0].repeat(12)}</span>
{/snippet}

<div class="stack">
<Panel title="pipeline">
  <ol class="spine">
    <li>
      <span class="rank">{G.marker}</span>
      <span class="name">sources</span>
      {#if conns.loading}
        {@render pending()}
      {:else}
        <span class="stat">
          {conns.data.length} connected{byType ? ` · ${byType}` : ""}
        </span>
        {#if noToken}
          <Badge tone="warn">{noToken} without a token</Badge>
        {/if}
      {/if}
    </li>
    <li>
      <span class="rank">{G.marker}</span>
      <span class="name">projects</span>
      {#if projects.loading}
        {@render pending()}
      {:else}
        <span class="stat">
          {projects.data.length} registered · {knowledge.length} knowledge · {trackers}
          tracker
        </span>
        {#if noWiki}<Badge tone="warn">{noWiki} without a wiki</Badge>{/if}
        {#if !conns.loading && !conns.data.length}
          <Badge tone="muted">needs a source</Badge>
        {/if}
      {/if}
    </li>
    <li>
      <span class="rank">{G.marker}</span>
      <span class="name">repos</span>
      {#if repos.loading}
        {@render pending()}
      {:else}
        <span class="stat">
          {#if repos.data.length}
            <Meter
              value={ready / repos.data.length}
              width={8}
              tone={failing ? "warn" : "ok"}
              label="indexed"
            />
            {ready}/{repos.data.length} indexed · {chunks.toLocaleString()} chunks from {files.toLocaleString()} files{oldest
              ? ` · oldest ${oldest}`
              : ""}
          {:else}
            none linked
          {/if}
        </span>
        {#if failing}<Badge tone="danger">{failing} failing</Badge>{/if}
        {#if unmapped}
          <Badge tone="warn">{unmapped} without a component</Badge>
        {/if}
      {/if}
    </li>
  </ol>

  {#if conns.error || projects.error || repos.error}
    <Note tone="danger"
      >{conns.error ?? projects.error ?? repos.error}</Note
    >
  {/if}
</Panel>

{#if admin}
  <Panel title="sources"><SourcesPanel /></Panel>
{/if}
<Panel title="projects"><ProjectsPanel /></Panel>
<Panel title="repos"><ReposPanel /></Panel>
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
  }
  .spine {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .spine li {
    display: flex;
    align-items: center;
    gap: var(--gap);
    flex-wrap: wrap;
    font-size: var(--fs-sm);
  }
  .rank {
    color: var(--accent);
  }
  .name {
    min-width: 6rem;
    letter-spacing: var(--label-spacing);
  }
  .stat {
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .pending {
    color: var(--border);
    letter-spacing: 0.35em;
    user-select: none;
  }
</style>
