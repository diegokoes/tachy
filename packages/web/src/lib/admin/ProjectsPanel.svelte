<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { keep, recall } from "../kept";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import { createResource, errText } from "../resource.svelte";
  import {
    Badge,
    Button,
    Checkbox,
    Chip,
    CrudTable,
    DeleteButton,
    Field,
    FilterBar,
    Note,
    Select,
    type Column,
    type Draft,
  } from "../tui";
  import type { AreaRule, Component, Connection, Customer, Product, ProjectWiki, Repo, SourceProject, Team } from "./rows";
  import { INFO } from "./help";
  import { sectionHoist } from "./sectionAction.svelte";
  import ProjectCoverage, {
    type CoverageGap,
    type CoverageGroup,
  } from "./ProjectCoverage.svelte";

  type Found = { key: string; name: string };
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
  let discovering = $state<string | null>(null);

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
    if (!slug) return;
    discovering = slug;
    error = null;
    try {
      const res = await api.get<{
        ok: boolean;
        error?: string;
        projects?: Found[];
      }>(`/source-connections/${slug}/discover/projects`);
      if (!res.ok) throw new Error(res.error ?? "discovery failed");
      found[slug] = res.projects ?? [];
    } catch (e) {
      error = errText(e);
    } finally {
      discovering = null;
    }
  }

  async function loadWikis(p: SourceProject) {
    if (wikisFor[p.id]) return;
    try {
      const res = await api.get<{ ok: boolean; wikis?: Wiki[] }>(
        `/source-connections/${p.source_slug}/discover/wikis?project=${encodeURIComponent(p.external_key)}`,
      );
      wikisFor[p.id] = res.ok ? (res.wikis ?? []) : [];
    } catch {
      wikisFor[p.id] = [];
    }
  }

  async function openProject(p: SourceProject) {
    areaForm = { prefix: "", component: "" };
    if (!p.product_id) return;
    try {
      areas[p.id] = await api.get<AreaRule[]>(`/source-projects/${p.id}/areas`);
      if (p.product_slug && !components[p.product_slug])
        components[p.product_slug] = await api.get<Component[]>(
          `/products/${p.product_slug}/components`,
        );
    } catch (e) {
      error = errText(e);
    }
    if (p.source_type === "azure-devops") await loadWikis(p);
  }

  async function saveWikis(p: SourceProject, next: ProjectWiki[]) {
    busy = p.id;
    error = null;
    try {
      await api.patch(`/source-projects/${p.id}`, { wikis: next });
      await projects.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = null;
    }
  }

  /** Registering a wiki keeps whatever default is already set; un-registering
   *  the default hands the flag to whatever is left, so a project never ends up
   *  with wikis but no default for the tools to fall back on. */
  function toggleWiki(p: SourceProject, w: Wiki, on: boolean) {
    const kept = wikisOf(p).filter((x) => x.identifier !== w.identifier);
    const next = on
      ? [...kept, { identifier: w.identifier, name: w.name, type: w.type }]
      : kept;
    if (next.length && !next.some((x) => x.default)) next[0].default = true;
    return saveWikis(p, next);
  }

  function makeDefault(p: SourceProject, identifier: string) {
    return saveWikis(
      p,
      wikisOf(p).map((w) => ({ ...w, default: w.identifier === identifier })),
    );
  }

  async function addArea(p: SourceProject) {
    error = null;
    try {
      await api.put(`/source-projects/${p.id}/areas`, {
        area_prefix: areaForm.prefix.trim(),
        component_slug: areaForm.component,
      });
      areaForm = { prefix: "", component: "" };
      areas[p.id] = await api.get<AreaRule[]>(`/source-projects/${p.id}/areas`);
    } catch (e) {
      error = errText(e);
    }
  }

  async function delArea(p: SourceProject, id: string) {
    error = null;
    try {
      await api.delete(`/source-projects/${p.id}/areas/${id}`);
      areas[p.id] = await api.get<AreaRule[]>(`/source-projects/${p.id}/areas`);
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
      initial: myProducts[0]?.slug ?? "",
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
      value: (p) => {
        const list = wikisOf(p);
        if (!list.length) return "";
        const rest = list.length - 1;
        return rest ? `${defaultWikiOf(p)} +${rest}` : defaultWikiOf(p);
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

  function payload(d: Draft) {
    const product = d.product_slug ? String(d.product_slug) : "";
    return {
      name: String(d.name ?? "").trim() || String(d.external_key).trim(),
      customer_slug: d.customer_slug ? String(d.customer_slug) : null,
      ...(product
        ? { product_slug: product }
        : { product_slug: null, team_slug: String(d.team_slug ?? "") }),
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
      const g = groups.get(key) ?? { key, ...head, gaps: [] };
      g.gaps.push(gap);
      groups.set(key, g);
    };
    const byId = new Map(projects.data.map((p) => [p.id, p]));
    const headOf = (p: SourceProject) => ({
      label: p.external_key,
      detail: [p.source_slug, p.name !== p.external_key ? p.name : ""]
        .filter(Boolean)
        .join(" · "),
      filter: p.external_key,
    });

    for (const p of projects.data) {
      if (!p.product_id) continue;
      if (p.source_type === "azure-devops" && !wikisOf(p).length)
        add(p.id, headOf(p), { text: "no wiki set", tone: "warn" });
      if (!reposOf(p).length)
        add(p.id, headOf(p), { text: "no repos linked", tone: "warn" });
    }

    for (const r of repos.data) {
      const p = r.source_project_id ? byId.get(r.source_project_id) : undefined;
      const key = p?.id ?? r.source_project_id ?? "::none";
      const head = p
        ? headOf(p)
        : { label: r.project_key ?? "no project", detail: r.source_slug ?? "" };
      if (!r.component_id)
        add(key, head, { text: `repo ${r.slug} has no component`, tone: "warn" });
      if (r.index_status === "error")
        add(key, head, { text: `repo ${r.slug} index failing`, tone: "danger" });
    }

    for (const [slug, list] of Object.entries(found))
      for (const g of list)
        if (!registered.has(`${slug} ${g.key}`))
          add(
            `found ${slug} ${g.key}`,
            { label: g.key, detail: slug },
            { text: "discovered, not registered", tone: "warn" },
          );

    const rank = (g: CoverageGroup) =>
      g.gaps.some((x) => x.tone === "danger") ? 0 : 1;
    return [...groups.values()].sort(
      (a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label),
    );
  });

  const coverageTone = $derived(
    coverage.some((g) => g.gaps.some((x) => x.tone === "danger"))
      ? ("danger" as const)
      : coverage.length
        ? ("warn" as const)
        : undefined,
  );

  let showCoverage = $state(false);

  onMount(reload);

  /** The project whose record dialog is open, if one is. */
  let opened = $state<SourceProject | null>(null);

  /* What hangs off a project with a product — its area rules, its product's
     components, its wikis, fetched when the dialog opens on it, and again
     when an edit changes what it hangs off. */
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
    const q = filter.trim().toLowerCase();
    if (!q) return projects.data;
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
        .includes(q),
    );
  });
</script>

{#snippet productCell(p: SourceProject)}
  {#if p.product_slug}
    <Badge tone="accent">{p.product_slug}</Badge>
  {:else}
    <span class="dim">none</span>
  {/if}
{/snippet}

{#snippet detail(p: SourceProject)}
  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if !p.product_id}
    <p class="dim">
      A ticket target only. Nothing is filed under it. Give it a {t("product")}
      to ingest its items and attach wikis, repos and area rules.
    </p>
  {:else}
    <div class="detail">
      <div class="block">
        <span class="dim" title="ADO: one project wiki plus one code wiki per repo."
          >wikis</span
        >
        {#if p.source_type === "azure-devops"}
          {#each wikisFor[p.id] ?? [] as w (w.identifier)}
            {@const on = wikisOf(p).some((x) => x.identifier === w.identifier)}
            {@const isDefault = on && defaultWikiOf(p) === w.identifier}
            <div class="wrow">
              <Checkbox
                ariaLabel={`register ${w.name}`}
                checked={on}
                disabled={!canEditProject(p) || busy === p.id}
                onchange={(checked) => toggleWiki(p, w, checked)}
              />
              <span class:muted={!on}>{w.name}</span>
              {#if w.type}<span class="dim sm">{w.type}</span>{/if}
              {#if isDefault}
                <Badge tone="accent" title="used when no wiki is named">default</Badge>
              {:else if on && canEditProject(p)}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === p.id}
                  onclick={() => makeDefault(p, w.identifier)}>make default</Button
                >
              {/if}
            </div>
          {/each}
          {#if !(wikisFor[p.id] ?? []).length}
            <span class="dim sm">no wikis readable with this token</span>
          {:else if !wikisOf(p).length}
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
        {#if reposOf(p).length}
          <div class="chips">
            {#each reposOf(p) as r (r.id)}
              <Chip tone={r.component_slug ? "default" : "warn"}>
                {r.slug}{r.component_slug
                  ? ` → ${r.component_slug}`
                  : " (no component)"}
              </Chip>
            {/each}
          </div>
        {:else}
          <span class="dim sm">none linked. Add them under repos below</span>
        {/if}
      </div>

      <div class="block wide">
        <span class="dim" title={INFO.area}>area path → component</span>
        {#each areas[p.id] ?? [] as a (a.id)}
          <div class="arow">
            <code>{a.area_prefix}</code>
            <span>→ {a.component_slug}</span>
            {#if canEditProject(p)}
              <DeleteButton
                label="remove rule"
                onclick={() => delArea(p, a.id)}
              />
            {/if}
          </div>
        {/each}
        {#if !(areas[p.id] ?? []).length}
          <span class="dim sm">
            No rules. Items keep whatever component the analysis infers.
          </span>
        {/if}

        {#if canEditProject(p) && p.product_slug}
          <div class="arow add">
            <input
              aria-label="area prefix"
              bind:value={areaForm.prefix}
              onkeydown={(e) => e.key === "Enter" && addArea(p)}
            />
            <Select
              bind:value={areaForm.component}
              aria-label="component"
              options={[
                { value: "", label: "component…" },
                ...(components[p.product_slug] ?? []).map((c) => ({
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
              onclick={() => addArea(p)}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet formExtra(f: {
  mode: "create" | "edit";
  row: SourceProject | null;
  draft: Draft;
})}
  {#if f.mode === "create"}
    {@const slug = String(f.draft.source_slug ?? "")}
    {@const hits = found[slug] ?? []}
    <!-- Full width, and a button that says what it does: the picker is the
         point of the field, not an ornament beside a key you typed. -->
    <div class="find">
      <Field
        label="find a project"
        info="Ask the connection what it can see, instead of typing a key."
        plain
      >
        <Button
          variant="ghost"
          size="sm"
          icon="discover"
          busy={discovering === slug}
          disabled={!slug}
          onclick={() => discover(slug)}
          >{slug ? `ask ${slug}` : "pick a connection first"}</Button
        >
      </Field>
      {#if hits.length}
        <div class="chips">
          {#each hits as g (g.key)}
            <Chip
              tone={f.draft.external_key === g.key ? "accent" : "default"}
              title={g.key}
              onclick={() => {
                f.draft.external_key = g.key;
                if (!f.draft.name) f.draft.name = g.name;
              }}>{g.name}</Chip
            >
          {/each}
        </div>
      {:else if discovering !== slug && slug}
        <span class="dim sm">nothing found yet</span>
      {/if}
    </div>
  {:else if f.row}
    <div class="probe">{@render detail(f.row)}</div>
  {/if}
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}

<div class="bar">
  <FilterBar
    bind:value={filter}
    shown={filtered.length}
    total={projects.data.length}
    placeholder="filter projects…"
    label="filter projects"
  />
  <Button
    variant="ghost"
    size="sm"
    icon={coverage.length ? "issues" : "success"}
    tone={coverageTone}
    title={coverage.length
      ? `${coverage.length} project(s) not fully wired up`
      : "every project is wired up"}
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
