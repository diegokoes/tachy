<script lang="ts">
  import { onMount } from "svelte";
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
    Field,
    Note,
    Select,
    type Column,
    type Draft,
  } from "../tui";
  import {
    TIP,
    type AreaRule,
    type Component,
    type Connection,
    type Customer,
    type Product,
    type ProjectWiki,
    type Repo,
    type SourceProject,
    type Team,
  } from "./shared";

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
  let expanded = $state(new Set<string>());
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

  async function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
      expanded = next;
      return;
    }
    next.add(id);
    expanded = next;
    areaForm = { prefix: "", component: "" };

    const p = projects.data.find((x) => x.id === id);
    if (!p || p.role !== "knowledge") return;
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

  /* One column for both, because a project is scoped by exactly one of them:
     a knowledge project belongs to a product, a tracker to a team. */
  const scopeOf = (p: SourceProject) => p.product_slug ?? p.team_slug;

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
      width: "14rem",
      edit: "text",
      required: true,
      editable: () => false,
      hint: TIP.project,
    },
    {
      key: "name",
      label: "name",
      formOnly: true,
      edit: "text",
      hint: "How it reads in lists here. Defaults to the project's own key.",
    },
    {
      key: "role",
      label: "role",
      width: "9rem",
      edit: "select",
      required: true,
      initial: "knowledge",
      options: [
        { value: "knowledge", label: "knowledge" },
        { value: "tracker", label: "tracker" },
      ],
      cell: roleCell,
    },
    {
      key: "scope",
      label: t("team"),
      width: "12rem",
      edit: "select",
      required: true,
      hint: (d) =>
        d.role === "tracker"
          ? `The ${t("team")} that raises work items here. Nothing is filed under a tracker.`
          : `The ${t("product")} its items ingest into. It can also carry the wiki, repos and area rules.`,
      options: (d) =>
        d.role === "tracker"
          ? myTeams.map((tm) => ({ value: tm.slug, label: tm.name }))
          : myProducts.map((p) => ({ value: p.slug, label: p.name })),
      value: scopeOf,
    },
    {
      key: "customer_slug",
      label: "customer",
      width: "10rem",
      edit: "select",
      hint: "Set only when the whole project exists for one customer. Its items are then theirs by configuration, which beats guessing at the sender's email domain. Leave empty for a project serving many.",
      options: [
        { value: "", label: "(none — serves many)" },
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
      value: (p) => (p.role === "knowledge" ? reposOf(p).length : ""),
    },
  ]);

  function payload(d: Draft) {
    const role = String(d.role);
    return {
      role,
      name: String(d.name ?? "").trim() || String(d.external_key).trim(),
      customer_slug: d.customer_slug ? String(d.customer_slug) : null,
      ...(role === "knowledge"
        ? { product_slug: String(d.scope) }
        : { team_slug: String(d.scope) }),
    };
  }

  /** What is configured but not wired up — the setup screen's to-do list. */
  const gaps = $derived.by(() => {
    const registered = new Set(
      projects.data.map((p) => `${p.source_slug} ${p.external_key}`),
    );
    const unregistered: string[] = [];
    for (const [slug, list] of Object.entries(found))
      for (const g of list)
        if (!registered.has(`${slug} ${g.key}`)) unregistered.push(g.key);
    const knowledge = projects.data.filter((p) => p.role === "knowledge");
    return {
      unregistered,
      noWiki: knowledge.filter(
        (p) => p.source_type === "azure-devops" && !wikisOf(p).length,
      ),
      noRepos: knowledge.filter((p) => reposOf(p).length === 0),
      repoNoComponent: repos.data.filter((r) => !r.component_id),
      brokenIndex: repos.data.filter((r) => r.index_status === "error"),
    };
  });

  const clean = $derived(
    !gaps.unregistered.length &&
      !gaps.noWiki.length &&
      !gaps.noRepos.length &&
      !gaps.repoNoComponent.length &&
      !gaps.brokenIndex.length,
  );

  onMount(reload);
</script>

{#snippet roleCell(p: SourceProject)}
  <Badge tone={p.role === "knowledge" ? "accent" : "muted"}>{p.role}</Badge>
{/snippet}

{#snippet detail(p: SourceProject)}
  {#if p.role === "tracker"}
    <p class="dim">
      A tracker — work items are raised and reassigned here, and nothing is
      filed under it. Give it a {t("product")} to make it a knowledge project.
    </p>
  {:else}
    <div class="detail">
      <div class="block">
        <span class="dim" title="An ADO project usually has several: one project wiki plus a code wiki per repo."
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
              none registered — tick the ones this {t("product")} should search.
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
          <span class="dim sm">none linked — add them under repos below</span>
        {/if}
      </div>

      <div class="block wide">
        <span class="dim" title={TIP.area}>area path → component</span>
        {#each areas[p.id] ?? [] as a (a.id)}
          <div class="arow">
            <code>{a.area_prefix}</code>
            <span>→ {a.component_slug}</span>
            {#if canEditProject(p)}
              <Button
                variant="ghost"
                tone="danger"
                square
                icon="cancel"
                title="remove rule"
                aria-label="remove rule"
                onclick={() => delArea(p, a.id)}
              />
            {/if}
          </div>
        {/each}
        {#if !(areas[p.id] ?? []).length}
          <span class="dim sm">
            No rules — items keep whatever component the analysis infers.
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
          <span class="dim sm">{TIP.area}</span>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet discoverField(f: {
  mode: "create" | "edit";
  row: SourceProject | null;
  draft: Draft;
})}
  {#if f.mode === "create"}
    {@const slug = String(f.draft.source_slug ?? "")}
    {@const hits = found[slug] ?? []}
    <Field
      label="discover"
      hint="Ask the source which projects this token can see, then pick one instead of typing its key."
    >
      <Button
        variant="ghost"
        square
        icon="analyze"
        busy={discovering === slug}
        disabled={!slug}
        aria-label="discover"
        title="discover"
        onclick={() => discover(slug)}
      />
    </Field>
    {#if hits.length}
      <div class="chips">
        {#each hits as g (g.key)}
          <Chip
            tone={f.draft.external_key === g.key ? "accent" : "default"}
            onclick={() => {
              f.draft.external_key = g.key;
              if (!f.draft.name) f.draft.name = g.name;
            }}>{g.name}</Chip
          >
        {/each}
      </div>
    {/if}
  {/if}
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}

<CrudTable
  {columns}
  rows={projects.data}
  rowKey={(p) => p.id}
  loading={projects.loading}
  error={projects.error}
  emptyTitle="No projects registered yet."
  canEdit={canEditProject}
  canDelete={canEditProject}
  canCreate={canAdd}
  addLabel="register project"
  editTitle={(p) => p.external_key}
  expand={detail}
  {expanded}
  ontoggle={toggle}
  formExtra={discoverField}
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
    projects.mutate(async () => {
      await api.delete(`/source-projects/${row.id}`);
      const next = new Set(expanded);
      next.delete(row.id);
      expanded = next;
    })}
/>

<div class="coverage">
  <p class="ch">coverage</p>
  <ul class="gaps">
    {#if gaps.unregistered.length}
      <li>
        <span class="warn-dot">●</span>
        {gaps.unregistered.length} discovered project(s) not registered:
        <span class="dim">{gaps.unregistered.join(", ")}</span>
      </li>
    {/if}
    {#if gaps.noWiki.length}
      <li>
        <span class="warn-dot">●</span> no wiki set:
        <span class="dim">
          {gaps.noWiki.map((p) => p.external_key).join(", ")}
        </span>
      </li>
    {/if}
    {#if gaps.noRepos.length}
      <li>
        <span class="warn-dot">●</span> no repos linked:
        <span class="dim">
          {gaps.noRepos.map((p) => p.external_key).join(", ")}
        </span>
      </li>
    {/if}
    {#if gaps.repoNoComponent.length}
      <li>
        <span class="warn-dot">●</span> repos with no component (code search
        can't be narrowed):
        <span class="dim">
          {gaps.repoNoComponent.map((r) => r.slug).join(", ")}
        </span>
      </li>
    {/if}
    {#if gaps.brokenIndex.length}
      <li>
        <span class="err-dot">●</span> index failing:
        <span class="dim">
          {gaps.brokenIndex.map((r) => r.slug).join(", ")}
        </span>
      </li>
    {/if}
    {#if clean}
      <li class="dim">
        Nothing outstanding. Run “discover” when registering a project to check
        for ones that were never picked up.
      </li>
    {/if}
  </ul>
</div>

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

  .coverage {
    margin-top: var(--pad-4);
  }
  .ch {
    margin: 0 0 var(--pad-2);
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .gaps {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: var(--fs-sm);
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  .warn-dot {
    color: var(--warn);
  }
  .err-dot {
    color: var(--danger);
  }
</style>
