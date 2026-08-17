<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import AsciiSelect from "../AsciiSelect.svelte";
  import DeleteButton from "./DeleteButton.svelte";
  import { Button, ErrorMark } from "../tui";
  import {
    TIP,
    errText,
    type AreaRule,
    type Component,
    type Connection,
    type Product,
    type ProjectRole,
    type Repo,
    type SourceProject,
    type Team,
  } from "./shared";

  type Found = { key: string; name: string };
  type Wiki = { identifier: string; name: string; type?: string };

  let projects = $state<SourceProject[]>([]);
  let connections = $state<Connection[]>([]);
  let products = $state<Product[]>([]);
  let teams = $state<Team[]>([]);
  let repos = $state<Repo[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let expanded = $state<string | null>(null);
  let areas = $state<Record<string, AreaRule[]>>({});
  let components = $state<Record<string, Component[]>>({});
  let wikisFor = $state<Record<string, Wiki[]>>({});
  let busy = $state<string | null>(null);

  /** Live from the source, so admins pick a real project instead of typing one. */
  let found = $state<Record<string, Found[]>>({});
  let discovering = $state<string | null>(null);

  let showForm = $state(false);
  let form = $state({
    source_slug: "",
    external_key: "",
    name: "",
    role: "knowledge" as ProjectRole,
    product_slug: "",
    team_slug: "",
  });
  let areaForm = $state({ area_prefix: "", component_slug: "" });

  const teamOf = (p: SourceProject) => p.team_slug;
  const canEditProject = (p: SourceProject) =>
    canCurateScope({ team_slug: teamOf(p) });
  const canAdd = $derived(
    products.some((p) => canCurateScope({ team_slug: p.team_slug })) ||
      teams.some((tm) => canCurateScope({ team_slug: tm.slug })),
  );
  const wikiOf = (p: SourceProject) =>
    (p.wiki as { identifier?: string })?.identifier ?? "";
  const reposOf = (p: SourceProject) =>
    repos.filter((r) => r.source_project_id === p.id);

  const productTeam = (slug: string) =>
    products.find((p) => p.slug === slug)?.team_slug ?? "";

  async function load() {
    loading = true;
    error = null;
    try {
      [projects, connections, products, teams] = await Promise.all([
        api.get<SourceProject[]>("/source-projects"),
        api.get<Connection[]>("/source-connections"),
        api.get<Product[]>("/products"),
        api.get<Team[]>("/teams"),
      ]);
      repos = (await api.get<{ repos: Repo[] }>("/repos")).repos;
      if (!form.source_slug && connections.length)
        form.source_slug = connections[0].slug;
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function discover(slug: string) {
    discovering = slug;
    error = null;
    try {
      const res = await api.get<{ ok: boolean; error?: string; projects?: Found[] }>(
        `/source-connections/${slug}/discover/projects`,
      );
      if (!res.ok) throw new Error(res.error ?? "discovery failed");
      found[slug] = res.projects ?? [];
    } catch (e) {
      error = errText(e);
    } finally {
      discovering = null;
    }
  }

  async function loadWikis(p: SourceProject) {
    const key = p.id;
    if (wikisFor[key]) return;
    try {
      const res = await api.get<{ ok: boolean; error?: string; wikis?: Wiki[] }>(
        `/source-connections/${p.source_slug}/discover/wikis?project=${encodeURIComponent(p.external_key)}`,
      );
      wikisFor[key] = res.ok ? (res.wikis ?? []) : [];
    } catch {
      wikisFor[key] = [];
    }
  }

  async function expand(p: SourceProject) {
    if (expanded === p.id) {
      expanded = null;
      return;
    }
    expanded = p.id;
    areaForm = { area_prefix: "", component_slug: "" };
    if (p.role !== "knowledge") return;
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

  async function add(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    error = null;
    try {
      await api.post("/source-projects", {
        source_slug: form.source_slug,
        external_key: form.external_key.trim(),
        name: form.name.trim() || form.external_key.trim(),
        role: form.role,
        ...(form.role === "knowledge"
          ? { product_slug: form.product_slug }
          : { team_slug: form.team_slug }),
      });
      form.external_key = "";
      form.name = "";
      showForm = false;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function setWiki(p: SourceProject, identifier: string) {
    busy = p.id;
    error = null;
    try {
      await api.patch(`/source-projects/${p.id}`, {
        wiki: identifier ? { identifier, name: identifier } : null,
      });
      await load();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = null;
    }
  }

  async function del(p: SourceProject) {
    error = null;
    try {
      await api.delete(`/source-projects/${p.id}`);
      if (expanded === p.id) expanded = null;
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  async function addArea(e: SubmitEvent, p: SourceProject) {
    e.preventDefault();
    error = null;
    try {
      await api.put(`/source-projects/${p.id}/areas`, {
        area_prefix: areaForm.area_prefix.trim(),
        component_slug: areaForm.component_slug,
      });
      areaForm = { area_prefix: "", component_slug: "" };
      areas[p.id] = await api.get<AreaRule[]>(`/source-projects/${p.id}/areas`);
    } catch (err) {
      error = errText(err);
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

  /** What is configured but not wired up — the setup screen's to-do list. */
  const gaps = $derived.by(() => {
    const registered = new Set(projects.map((p) => `${p.source_slug} ${p.external_key}`));
    const unregistered: { source: string; key: string }[] = [];
    for (const [slug, list] of Object.entries(found))
      for (const g of list)
        if (!registered.has(`${slug} ${g.key}`))
          unregistered.push({ source: slug, key: g.key });
    const knowledge = projects.filter((p) => p.role === "knowledge");
    return {
      unregistered,
      noWiki: knowledge.filter(
        (p) => p.source_type === "azure-devops" && !wikiOf(p),
      ),
      noRepos: knowledge.filter((p) => reposOf(p).length === 0),
      repoNoComponent: repos.filter((r) => !r.component_id),
      brokenIndex: repos.filter((r) => r.index_status === "error"),
    };
  });

  onMount(load);
</script>

{#if error}
  <p class="error clamped" title={error}>
    <ErrorMark message={error} />
    <span class="etxt">{error}</span>
  </p>
{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<p class="muted hint">
  A project is one Azure DevOps project, Freshdesk group or GitHub owner/repo.
  Register it and tachy knows where its items belong, which wiki documents it and
  which repos hold its code — a <em>knowledge</em> project maps to a {t("product")};
  a <em>tracker</em> is a productless place to raise and reassign work items.
</p>

<table>
  <thead><tr>
    <th>source</th>
    <th class="tip" title={TIP.project}>project</th>
    <th class="tip" title={TIP.role}>role</th>
    <th>{t("product")} / team</th>
    <th>wiki</th>
    <th>repos</th>
    <th>areas</th>
    <th></th>
  </tr></thead>
  <tbody>
    {#each projects as p (p.id)}
      <tr>
        <td class="muted">{p.source_slug}</td>
        <td>
          <button class="linkish" onclick={() => expand(p)}>
            {expanded === p.id ? "▾" : "▸"} {p.external_key}
          </button>
        </td>
        <td><span class="badge" class:on={p.role === "knowledge"}>{p.role}</span></td>
        <td>{p.product_slug ?? p.team_slug}</td>
        <td class="muted">{wikiOf(p) || (p.role === "knowledge" ? "—" : "")}</td>
        <td class="muted">{p.role === "knowledge" ? reposOf(p).length : ""}</td>
        <td class="muted">{p.role === "knowledge" ? (areas[p.id]?.length ?? "") : ""}</td>
        <td class="actions">
          {#if canEditProject(p)}
            <DeleteButton onConfirm={() => del(p)} />
          {/if}
        </td>
      </tr>
      {#if expanded === p.id}
        <tr class="detail-row">
          <td colspan="8">
            {#if p.role === "tracker"}
              <p class="muted">
                A tracker project — work items are created and reassigned here, and
                nothing is filed under it. Give it a {t("product")} to make it a
                knowledge project.
              </p>
            {:else}
              <div class="detail">
                <div class="block">
                  <span class="muted">wiki</span>
                  {#if p.source_type === "azure-devops"}
                    <AsciiSelect value={wikiOf(p)} disabled={!canEditProject(p) || busy === p.id}
                      options={[{ value: "", label: "(none)" },
                        ...(wikisFor[p.id] ?? []).map((w) => ({ value: w.identifier, label: w.name }))]}
                      onchange={(v) => setWiki(p, String(v))} />
                    {#if !(wikisFor[p.id] ?? []).length}
                      <span class="muted hint">no wikis readable with this token</span>
                    {/if}
                  {:else}
                    <span class="muted hint">wikis come from Azure DevOps only</span>
                  {/if}
                </div>

                <div class="block">
                  <span class="muted">repos</span>
                  {#if reposOf(p).length}
                    <div class="chips">
                      {#each reposOf(p) as r (r.id)}
                        <span class="chip" class:warn={!r.component_slug}>
                          {r.slug}{r.component_slug ? ` → ${r.component_slug}` : " (no component)"}
                        </span>
                      {/each}
                    </div>
                  {:else}
                    <span class="muted hint">none linked — add them under Org › repos</span>
                  {/if}
                </div>

                <div class="block wide">
                  <span class="muted tip" title={TIP.area}>area path → component</span>
                  <table class="inner">
                    <tbody>
                      {#each areas[p.id] ?? [] as a (a.id)}
                        <tr>
                          <td><code>{a.area_prefix}</code></td>
                          <td>→ {a.component_slug}</td>
                          <td class="actions">
                            {#if canEditProject(p)}
                              <DeleteButton onConfirm={() => delArea(p, a.id)} />
                            {/if}
                          </td>
                        </tr>
                      {/each}
                      {#if !(areas[p.id] ?? []).length}
                        <tr><td colspan="3" class="muted">
                          No rules — items keep whatever component the analysis infers.
                        </td></tr>
                      {/if}
                    </tbody>
                  </table>
                  {#if canEditProject(p) && p.product_slug}
                    <form class="add-form" onsubmit={(e) => addArea(e, p)}>
                      <label>prefix
                        <input bind:value={areaForm.area_prefix} required
                          placeholder={`${p.external_key}\\Portal`} />
                      </label>
                      <label>component
                        <AsciiSelect bind:value={areaForm.component_slug}
                          options={(components[p.product_slug] ?? []).map((c) => ({
                            value: c.slug, label: `${c.name} (${c.slug})` }))} />
                      </label>
                      <Button variant="ghost" tone="ok" square icon="plus" type="submit" title="add rule"
                        aria-label="add rule" disabled={!areaForm.component_slug} />
                    </form>
                  {/if}
                </div>
              </div>
            {/if}
          </td>
        </tr>
      {/if}
    {/each}
    {#if !loading && projects.length === 0}
      <tr><td colspan="8" class="muted">No projects registered yet.</td></tr>
    {/if}
  </tbody>
</table>

{#if canAdd}
  <div class="add-area">
    {#if !showForm}
      <Button variant="ghost" tone="ok" square icon="plus" title="register project" aria-label="register project" disabled={!connections.length} onclick={() => (showForm = true)} />
      {#if !loading && !connections.length}<span class="muted hint"> — add a source connection first</span>{/if}
    {:else}
      <form class="conn-form" onsubmit={add}>
        <div class="add-form">
          <label>source
            <AsciiSelect bind:value={form.source_slug}
              options={connections.map((c) => ({ value: c.slug, label: c.slug }))} />
          </label>
          <Button
            variant="ghost"
            square
            icon="discover"
            type="button"
            title="discover projects"
            aria-label="discover projects"
            busy={discovering === form.source_slug}
            onclick={() => discover(form.source_slug)}
          />
          <label class="tip" title={TIP.project}>project
            {#if (found[form.source_slug] ?? []).length}
              <AsciiSelect bind:value={form.external_key}
                options={[...(found[form.source_slug] ?? []).map((g) => ({ value: g.key, label: g.name })),
                  { value: "", label: "(type one instead)" }]} />
            {/if}
            {#if !(found[form.source_slug] ?? []).length || !form.external_key}
              <input bind:value={form.external_key} required placeholder="project name / group id" />
            {/if}
          </label>
          <label class="tip" title={TIP.role}>role
            <AsciiSelect bind:value={form.role}
              options={[{ value: "knowledge", label: "knowledge" }, { value: "tracker", label: "tracker" }]} />
          </label>
          {#if form.role === "knowledge"}
            <label>{t("product")}
              <AsciiSelect bind:value={form.product_slug}
                options={products.filter((p) => canCurateScope({ team_slug: p.team_slug }))
                  .map((p) => ({ value: p.slug, label: `${p.name} (${p.slug})` }))} />
            </label>
          {:else}
            <label>team
              <AsciiSelect bind:value={form.team_slug}
                options={teams.filter((tm) => canCurateScope({ team_slug: tm.slug }))
                  .map((tm) => ({ value: tm.slug, label: tm.slug }))} />
            </label>
          {/if}
          <Button variant="ghost" tone="accent" square icon="save" type="submit" aria-label="save" busy={saving}
            disabled={form.role === "knowledge" ? !form.product_slug : !form.team_slug} />
          <Button variant="ghost" square icon="cancel" aria-label="cancel" onclick={() => (showForm = false)} />
        </div>
        <p class="muted hint">
          {form.role === "knowledge"
            ? "Its items ingest into this " + t("product") + ", and it can carry the wiki, repos and area rules."
            : "No " + t("product") + ": a place to raise and reassign work items, nothing is filed under it."}
        </p>
      </form>
    {/if}
  </div>
{/if}

<h4>Coverage</h4>
<ul class="gaps">
  {#if gaps.unregistered.length}
    <li><span class="warn-dot">●</span> {gaps.unregistered.length} discovered project(s) not registered:
      <span class="muted">{gaps.unregistered.map((g) => g.key).join(", ")}</span></li>
  {/if}
  {#if gaps.noWiki.length}
    <li><span class="warn-dot">●</span> no wiki set: <span class="muted">{gaps.noWiki.map((p) => p.external_key).join(", ")}</span></li>
  {/if}
  {#if gaps.noRepos.length}
    <li><span class="warn-dot">●</span> no repos linked: <span class="muted">{gaps.noRepos.map((p) => p.external_key).join(", ")}</span></li>
  {/if}
  {#if gaps.repoNoComponent.length}
    <li><span class="warn-dot">●</span> repos with no component (code search can't be narrowed):
      <span class="muted">{gaps.repoNoComponent.map((r) => r.slug).join(", ")}</span></li>
  {/if}
  {#if gaps.brokenIndex.length}
    <li><span class="err-dot">●</span> index failing: <span class="muted">{gaps.brokenIndex.map((r) => r.slug).join(", ")}</span></li>
  {/if}
  {#if !gaps.unregistered.length && !gaps.noWiki.length && !gaps.noRepos.length && !gaps.repoNoComponent.length && !gaps.brokenIndex.length}
    <li class="muted">Nothing outstanding. Hit “discover” on a source above to check for projects that were never registered.</li>
  {/if}
</ul>

<style>
  /* Two lines max: a failed discover can return a wall of text. */
  .clamped {
    display: flex;
    align-items: flex-start;
    gap: var(--pad-2);
  }
  .clamped .etxt {
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .conn-form { display: flex; flex-direction: column; gap: 0.5rem; }
  .hint { font-size: 0.8rem; }
  .linkish { background: none; border: none; padding: 0; color: inherit; font: inherit; cursor: pointer; }
  .linkish:hover { color: var(--accent); }
  .detail-row td { border-bottom: 1px solid var(--border); padding-top: 0; font-size: 0.85rem; }
  .detail { display: flex; flex-wrap: wrap; gap: 1.2rem; padding: 0.3rem 0 0.6rem; }
  .block { display: flex; flex-direction: column; gap: 0.3rem; }
  .block.wide { flex: 1 1 24rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .chip { font-size: 0.75rem; padding: 0.1rem 0.5rem; border: 1px solid var(--border); border-radius: 0.6rem; }
  .chip.warn { border-color: var(--warn); color: var(--warn); }
  table.inner { margin-bottom: 0.3rem; }
  table.inner td { border: none; padding: 0.1rem 0.6rem 0.1rem 0; }
  .gaps { list-style: none; padding: 0; margin: 0 0 1rem; font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.25rem; }
  .warn-dot { color: var(--warn); }
  .err-dot { color: var(--danger); }
</style>
