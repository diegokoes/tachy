<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { keep, recall } from "../shell/kept";
  import { api } from "../api";
  import { canCurateScope } from "../access/session.svelte";
  import { t } from "../terms";
  import { createResource, errText } from "../resource.svelte";
  import {
    Badge,
    Button,
    Checkbox,
    Chip,
    CrudTable,
    DeleteButton,
    FilterBar,
    Note,
    Select,
    type Column,
    type Draft,
  } from "../tui";
  import type {
    AreaRule,
    Connection,
    ProjectWiki,
    SourceProject,
  } from "./rows";
  import type { Component, Customer, Product, Team } from "../catalog/rows";
  import type { Repo } from "../code/rows";
  import { INFO } from "../admin/help";
  import { sectionHoist } from "../admin/sectionAction.svelte";
  import SourceFinder, { type Found } from "./SourceFinder.svelte";
  import ProjectCoverage, {
    type CoverageGap,
    type CoverageGroup,
  } from "./ProjectCoverage.svelte";

  type Wiki = { identifier: string; name: string; type?: string };

  const projects = createResource(
    () => api.get<SourceProject[]>("/source-projects"),
    [],
  );
  const connections = createResource(
    () => api.get<Connection[]>("/source-connections"),
    [],
  );
  const products = createResource(() => api.get<Product[]>("/products"), []);
  const teams = createResource(() => api.get<Team[]>("/teams"), []);
  const repos = createResource(
    () => api.get<{ repos: Repo[] }>("/repos").then((r) => r.repos),
    [],
  );
  const customers = createResource(() => api.get<Customer[]>("/customers"), []);

  let error = $state<string | null>(null);
  let areas = $state<Record<string, AreaRule[]>>({});
  let components = $state<Record<string, Component[]>>({});
  let wikisFor = $state<Record<string, Wiki[]>>({});
  let busy = $state<string | null>(null);
  let areaForm = $state({ prefix: "", component: "" });

  /** Live from the source, so admins pick a real project instead of typing one. */
  let found = $state<Record<string, Found[]>>({});

  const canEditProject = (p: SourceProject) =>
    canCurateScope({ team_slug: p.team_slug });
  const canAdd = $derived(
    connections.data.length > 0 &&
      (products.data.some((p) => canCurateScope({ team_slug: p.team_slug })) ||
        teams.data.some((tm) => canCurateScope({ team_slug: tm.slug }))),
  );
  const wikisOf = (p: SourceProject): ProjectWiki[] => p.wikis ?? [];
  const defaultWikiOf = (p: SourceProject) =>
    wikisOf(p).find((w) => w.default)?.identifier ??
    wikisOf(p)[0]?.identifier ??
    "";
  const reposOf = (p: SourceProject) =>
    repos.data.filter((r) => r.source_project_id === p.id);

  const myProducts = $derived(
    products.data.filter((p) => canCurateScope({ team_slug: p.team_slug })),
  );
  const myTeams = $derived(
    teams.data.filter((tm) => canCurateScope({ team_slug: tm.slug })),
  );

  async function reload() {
    await Promise.all([
      projects.reload(),
      connections.reload(),
      products.reload(),
      teams.reload(),
      repos.reload(),
      customers.reload(),
    ]);
  }

  async function discover(slug: string) {
    const answer = await api.get<{
      ok: boolean;
      error?: string;
      projects?: Found[];
    }>(`/source-connections/${slug}/discover/projects`);
    if (!answer.ok) throw new Error(answer.error ?? "discovery failed");
    found[slug] = answer.projects ?? [];
  }

  async function loadWikis(project: SourceProject) {
    if (wikisFor[project.id]) return;
    try {
      const answer = await api.get<{ ok: boolean; wikis?: Wiki[] }>(
        `/source-connections/${project.source_slug}/discover/wikis?project=${encodeURIComponent(project.external_key)}`,
      );
      wikisFor[project.id] = answer.ok ? (answer.wikis ?? []) : [];
    } catch {
      wikisFor[project.id] = [];
    }
  }

  async function openProject(project: SourceProject) {
    areaForm = { prefix: "", component: "" };
    if (!project.product_id) return;
    try {
      areas[project.id] = await api.get<AreaRule[]>(
        `/source-projects/${project.id}/areas`,
      );
      if (project.product_slug && !components[project.product_slug])
        components[project.product_slug] = await api.get<Component[]>(
          `/products/${project.product_slug}/components`,
        );
    } catch (e) {
      error = errText(e);
    }
    if (project.source_type === "azure-devops") await loadWikis(project);
  }

  async function saveWikis(project: SourceProject, next: ProjectWiki[]) {
    busy = project.id;
    error = null;
    try {
      await api.patch(`/source-projects/${project.id}`, { wikis: next });
      await projects.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = null;
    }
  }

  /**
   * Registering a wiki keeps whatever default is already set; un-registering
   * the default hands the flag to whatever is left, so a project never ends up
   * with wikis but no default for the tools to fall back on.
   */
  function toggleWiki(project: SourceProject, wiki: Wiki, on: boolean) {
    const kept = wikisOf(project).filter(
      (x) => x.identifier !== wiki.identifier,
    );
    const next = on
      ? [
          ...kept,
          { identifier: wiki.identifier, name: wiki.name, type: wiki.type },
        ]
      : kept;
    if (next.length && !next.some((x) => x.default)) next[0].default = true;
    return saveWikis(project, next);
  }

  function makeDefault(project: SourceProject, identifier: string) {
    return saveWikis(
      project,
      wikisOf(project).map((w) => ({
        ...w,
        default: w.identifier === identifier,
      })),
    );
  }

  async function addArea(project: SourceProject) {
    error = null;
    try {
      await api.put(`/source-projects/${project.id}/areas`, {
        area_prefix: areaForm.prefix.trim(),
        component_slug: areaForm.component,
      });
      areaForm = { prefix: "", component: "" };
      areas[project.id] = await api.get<AreaRule[]>(
        `/source-projects/${project.id}/areas`,
      );
    } catch (e) {
      error = errText(e);
    }
  }

  async function delArea(project: SourceProject, id: string) {
    error = null;
    try {
      await api.delete(`/source-projects/${project.id}/areas/${id}`);
      areas[project.id] = await api.get<AreaRule[]>(
        `/source-projects/${project.id}/areas`,
      );
    } catch (e) {
      error = errText(e);
    }
  }

  const columns: Column<SourceProject>[] = $derived([
    {
      key: "source_slug",
      label: "source",
      width: "11rem",
      edit: "select",
      required: true,
      editable: () => false,
      initial: connections.data[0]?.slug,
      options: connections.data.map((c) => ({ value: c.slug, label: c.slug })),
    },
    {
      key: "external_key",
      label: "project",
      edit: "text",
      required: true,
      editable: () => false,
      info: INFO.project,
    },
    {
      key: "name",
      label: "name",
      formOnly: true,
      edit: "text",
      info: "How it reads in lists here.",
    },
    {
      key: "product_slug",
      label: t("product"),
      width: "11rem",
      edit: "select",
      initial: "",
      info: `Ingest target. Also scopes wiki, repos, area rules. None: a ticket target only.`,
      options: [
        { value: "", label: "(none)" },
        ...myProducts.map((p) => ({ value: p.slug, label: p.name })),
      ],
      cell: productCell,
      value: (p) => p.product_slug ?? "",
    },
    {
      key: "team_slug",
      label: t("team"),
      width: "11rem",
      edit: "select",
      initial: myTeams[0]?.slug ?? "",
      info: `Whose members create work items here. A ${t("product")} brings its own ${t("team")}, so this only applies without one.`,
      options: myTeams.map((tm) => ({ value: tm.slug, label: tm.name })),
    },
    {
      key: "customer_slug",
      label: "customer",
      width: "10rem",
      edit: "select",
      info: "Single-customer projects only. Overrides email-domain attribution. Empty: many customers.",
      options: [
        { value: "", label: "(none, serves many)" },
        ...customers.data.map((cu) => ({ value: cu.slug, label: cu.name })),
      ],
    },
    {
      key: "wikis",
      label: "wikis",
      width: "11rem",
      value: (project) => {
        const wikis = wikisOf(project);
        if (!wikis.length) return "";
        const rest = wikis.length - 1;
        return rest
          ? `${defaultWikiOf(project)} +${rest}`
          : defaultWikiOf(project);
      },
    },
    {
      key: "repos",
      label: "repos",
      width: "6rem",
      align: "end",
      value: (p) => (p.product_id ? reposOf(p).length : ""),
    },
  ]);

  function payload(draft: Draft) {
    const product = draft.product_slug ? String(draft.product_slug) : "";
    return {
      name:
        String(draft.name ?? "").trim() || String(draft.external_key).trim(),
      customer_slug: draft.customer_slug ? String(draft.customer_slug) : null,
      ...(product
        ? { product_slug: product }
        : { product_slug: null, team_slug: String(draft.team_slug ?? "") }),
    };
  }

  const registered = $derived(
    new Set(projects.data.map((p) => `${p.source_slug} ${p.external_key}`)),
  );

  /** What is configured but not wired up, one group per project. */
  const coverage = $derived.by(() => {
    const groups = new Map<string, CoverageGroup>();
    const add = (
      key: string,
      head: Omit<CoverageGroup, "key" | "gaps">,
      gap: CoverageGap,
    ) => {
      const group = groups.get(key) ?? { key, ...head, gaps: [] };
      group.gaps.push(gap);
      groups.set(key, group);
    };
    const byId = new Map(projects.data.map((p) => [p.id, p]));
    const headOf = (p: SourceProject) => ({
      label: p.external_key,
      detail: [p.source_slug, p.name !== p.external_key ? p.name : ""]
        .filter(Boolean)
        .join(" · "),
      filter: p.external_key,
    });

    for (const project of projects.data) {
      if (!project.product_id) continue;
      if (project.source_type === "azure-devops" && !wikisOf(project).length)
        add(project.id, headOf(project), { text: "no wiki set", tone: "warn" });
      if (!reposOf(project).length)
        add(project.id, headOf(project), {
          text: "no repos linked",
          tone: "warn",
        });
    }

    for (const repo of repos.data) {
      const project = repo.source_project_id
        ? byId.get(repo.source_project_id)
        : undefined;
      const key = project?.id ?? repo.source_project_id ?? "::none";
      const head = project
        ? headOf(project)
        : {
            label: repo.project_key ?? "no project",
            detail: repo.source_slug ?? "",
          };
      if (!repo.component_id)
        add(key, head, {
          text: `repo ${repo.slug} has no component`,
          tone: "warn",
        });
      if (repo.index_status === "error")
        add(key, head, {
          text: `repo ${repo.slug} index failing`,
          tone: "danger",
        });
    }

    for (const [slug, hits] of Object.entries(found))
      for (const hit of hits)
        if (!registered.has(`${slug} ${hit.key}`))
          add(
            `found ${slug} ${hit.key}`,
            { label: hit.key, detail: slug },
            { text: "discovered, not registered", tone: "warn" },
          );

    const rank = (g: CoverageGroup) =>
      g.gaps.some((x) => x.tone === "danger") ? 0 : 1;
    return [...groups.values()].sort(
      (a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label),
    );
  });

  const coverageTone = $derived.by(() => {
    if (coverage.some((g) => g.gaps.some((x) => x.tone === "danger")))
      return "danger" as const;
    return coverage.length ? ("warn" as const) : undefined;
  });

  let showCoverage = $state(false);

  onMount(reload);

  /** The project whose record dialog is open, if one is. */
  let opened = $state<SourceProject | null>(null);

  // What hangs off a project with a product - its area rules, its product's
  // components, its wikis, fetched when the dialog opens on it, and again when
  // an edit changes what it hangs off.
  const hangs = $derived(
    opened ? `${opened.id} ${opened.product_slug ?? ""}` : "",
  );
  $effect(() => {
    if (!hangs) return;
    untrack(() => opened && void openProject(opened));
  });

  let filter = $state(recall("admin.projects.filter", ""));
  $effect(() => keep("admin.projects.filter", filter));
  const filtered = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return projects.data;
    return projects.data.filter((p) =>
      [
        p.external_key ?? "",
        p.name ?? "",
        p.source_slug ?? "",
        p.product_slug ?? "",
        p.team_slug ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  });
</script>

{#snippet productCell(project: SourceProject)}
  {#if project.product_slug}
    <Badge tone="accent">{project.product_slug}</Badge>
  {:else}
    <span class="dim">none</span>
  {/if}
{/snippet}

{#snippet detail(project: SourceProject)}
  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if !project.product_id}
    <p class="dim">
      A ticket target only. Nothing is filed under it. Give it a {t("product")}
      to ingest its items and attach wikis, repos and area rules.
    </p>
  {:else}
    <div class="detail">
      <div class="block">
        <span class="dim">wikis</span>
        {#if project.source_type === "azure-devops"}
          {#each wikisFor[project.id] ?? [] as w (w.identifier)}
            {@const on = wikisOf(project).some(
              (x) => x.identifier === w.identifier,
            )}
            {@const isDefault = on && defaultWikiOf(project) === w.identifier}
            <div class="wrow">
              <Checkbox
                ariaLabel={`register ${w.name}`}
                checked={on}
                disabled={!canEditProject(project) || busy === project.id}
                onchange={(checked) => toggleWiki(project, w, checked)}
              />
              <span class:muted={!on}>{w.name}</span>
              {#if w.type}<span class="dim sm">{w.type}</span>{/if}
              {#if isDefault}
                <Badge tone="accent">default</Badge>
              {:else if on && canEditProject(project)}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === project.id}
                  onclick={() => makeDefault(project, w.identifier)}
                  >make default</Button
                >
              {/if}
            </div>
          {/each}
          {#if !(wikisFor[project.id] ?? []).length}
            <span class="dim sm">no wikis readable with this token</span>
          {:else if !wikisOf(project).length}
            <span class="dim sm">
              none registered. Tick the ones this {t("product")} should search.
            </span>
          {/if}
        {:else}
          <span class="dim sm">wikis come from Azure DevOps only</span>
        {/if}
      </div>

      <div class="block">
        <span class="dim">repos</span>
        {#if reposOf(project).length}
          <div class="chips">
            {#each reposOf(project) as repo (repo.id)}
              <Chip tone={repo.component_slug ? "default" : "warn"}>
                {repo.slug}{repo.component_slug
                  ? ` → ${repo.component_slug}`
                  : " (no component)"}
              </Chip>
            {/each}
          </div>
        {:else}
          <span class="dim sm">none linked. Add them under repos below</span>
        {/if}
      </div>

      <div class="block wide">
        <span class="dim">area path → component</span>
        {#each areas[project.id] ?? [] as area (area.id)}
          <div class="arow">
            <code>{area.area_prefix}</code>
            <span>→ {area.component_slug}</span>
            {#if canEditProject(project)}
              <DeleteButton
                label="remove rule"
                onclick={() => delArea(project, area.id)}
              />
            {/if}
          </div>
        {/each}
        {#if !(areas[project.id] ?? []).length}
          <span class="dim sm">
            No rules. Items keep whatever component the analysis infers.
          </span>
        {/if}

        {#if canEditProject(project) && project.product_slug}
          <div class="arow add">
            <input
              aria-label="area prefix"
              bind:value={areaForm.prefix}
              onkeydown={(e) => e.key === "Enter" && addArea(project)}
            />
            <Select
              bind:value={areaForm.component}
              aria-label="component"
              options={[
                { value: "", label: "component…" },
                ...(components[project.product_slug] ?? []).map((c) => ({
                  value: c.slug,
                  label: `${c.name} (${c.slug})`,
                })),
              ]}
            />
            <Button
              variant="ghost"
              tone="ok"
              square
              icon="plus"
              title="add rule"
              aria-label="add rule"
              disabled={!areaForm.component || !areaForm.prefix.trim()}
              onclick={() => addArea(project)}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet formExtra(form: {
  mode: "create" | "edit";
  row: SourceProject | null;
  draft: Draft;
})}
  {#if form.mode === "create"}
    {@const slug = String(form.draft.source_slug ?? "")}
    {#key slug}
      <SourceFinder
        source={slug}
        label="fetch projects"
        empty="{slug} shows no projects to this token"
        hits={found[slug]}
        picked={String(form.draft.external_key ?? "")}
        registered={(key) => registered.has(`${slug} ${key}`)}
        onfetch={() => discover(slug)}
        onpick={(g) => {
          form.draft.external_key = g.key;
          if (!form.draft.name) form.draft.name = g.name;
        }}
      />
    {/key}
  {:else if form.row}
    <div class="probe">{@render detail(form.row)}</div>
  {/if}
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}

<div class="bar">
  <FilterBar
    bind:value={filter}
    shown={filtered.length}
    total={projects.data.length}
    label="filter projects"
  />
  <Button
    variant="ghost"
    size="sm"
    icon={coverage.length ? "issues" : "success"}
    tone={coverageTone}
    onclick={() => (showCoverage = true)}
    >coverage{coverage.length ? ` ${coverage.length}` : ""}</Button
  >
</div>

<CrudTable
  hoist={sectionHoist("projects")}
  {columns}
  rows={filtered}
  rowKey={(p) => p.id}
  loading={projects.loading}
  error={projects.error}
  emptyTitle={projects.data.length
    ? "No projects match the filter."
    : "No projects registered yet."}
  canEdit={canEditProject}
  canDelete={canEditProject}
  canCreate={canAdd}
  addLabel="register project"
  noun="project"
  editTitle={(p) => p.name || p.external_key}
  width="52rem"
  {formExtra}
  onform={(f) => (opened = f?.row ?? null)}
  oncreate={(d) =>
    projects.mutate(() =>
      api.post("/source-projects", {
        source_slug: d.source_slug,
        external_key: String(d.external_key).trim(),
        ...payload(d),
      }),
    )}
  onsave={(row, d) =>
    projects.mutate(() => api.patch(`/source-projects/${row.id}`, payload(d)))}
  ondelete={(row) =>
    projects.mutate(() => api.delete(`/source-projects/${row.id}`))}
/>

{#if showCoverage}
  <ProjectCoverage
    groups={coverage}
    onpick={(g) => {
      if (g.filter) filter = g.filter;
      showCoverage = false;
    }}
    onclose={() => (showCoverage = false)}
  />
{/if}

<style>
  .dim {
    color: var(--muted);
  }
  .sm {
    font-size: var(--fs-xs);
  }
  .detail {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-4);
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    align-items: flex-start;
  }
  .block.wide {
    flex: 1 1 24rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
  }
  .arow {
    display: flex;
    align-items: center;
    gap: var(--gap);
  }
  .arow.add {
    margin-top: var(--pad-2);
  }
  .arow.add input {
    min-width: 12rem;
  }
  .wrow {
    display: flex;
    align-items: center;
    gap: var(--gap);
    font-size: var(--fs-sm);
  }
  .muted {
    color: var(--muted);
  }

  .bar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gap);
  }
  /* Capitals, like the issues button it stands in for on this page. */
  .bar :global(.btn) {
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
</style>
