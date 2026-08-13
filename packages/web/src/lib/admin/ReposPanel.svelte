<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import AsciiSelect from "../AsciiSelect.svelte";
  import DeleteButton from "./DeleteButton.svelte";
  import {
    TIP,
    csv,
    errText,
    type Component,
    type Product,
    type Repo,
    type SourceProject,
  } from "./shared";

  type FoundRepo = { name: string; url: string; default_branch: string };

  let repos = $state<Repo[]>([]);
  let projects = $state<SourceProject[]>([]);
  let products = $state<Product[]>([]);
  let components = $state<Record<string, Component[]>>({});
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let indexing = $state<string | null>(null);

  let showForm = $state(false);
  let editingSlug = $state<string | null>(null);
  let form = $state({
    slug: "",
    url: "",
    source_project_id: "",
    product_slug: "",
    component: "",
    branch: "main",
    extensions: "",
    max_file_kb: "",
  });

  let found = $state<Record<string, FoundRepo[]>>({});
  let discovering = $state(false);
  let poll: ReturnType<typeof setInterval> | undefined;

  const knowledgeProjects = $derived(
    projects.filter((p) => p.role === "knowledge"),
  );
  const formProject = $derived(
    knowledgeProjects.find((p) => p.id === form.source_project_id),
  );
  const formProductSlug = $derived(
    formProject?.product_slug ?? form.product_slug,
  );
  const canEditRepo = (r: Repo) => {
    const project = projects.find((p) => p.id === r.source_project_id);
    const team =
      project?.team_slug ??
      products.find((p) => p.slug === r.product_slug)?.team_slug ??
      null;
    return canCurateScope({ team_slug: team });
  };
  const canAdd = $derived(
    products.some((p) => canCurateScope({ team_slug: p.team_slug })),
  );
  const busyIndex = $derived(
    repos.some((r) => r.index_status === "cloning" || r.index_status === "indexing"),
  );

  const freshness = (r: Repo) => {
    if (!r.last_indexed_at) return "never";
    const days = Math.floor(
      (Date.now() - new Date(r.last_indexed_at).getTime()) / 86_400_000,
    );
    return days === 0 ? "today" : `${days}d ago`;
  };

  async function load() {
    loading = true;
    error = null;
    try {
      const [repoRes, projectRes, productRes] = await Promise.all([
        api.get<{ repos: Repo[] }>("/repos"),
        api.get<SourceProject[]>("/source-projects"),
        api.get<Product[]>("/products"),
      ]);
      repos = repoRes.repos;
      projects = projectRes;
      products = productRes;
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function loadComponents(productSlug: string) {
    if (!productSlug || components[productSlug]) return;
    try {
      components[productSlug] = await api.get<Component[]>(
        `/products/${productSlug}/components`,
      );
    } catch {
      components[productSlug] = [];
    }
  }

  /** Repos of the chosen project, so the clone URL is picked, not transcribed. */
  async function discover() {
    if (!formProject) return;
    discovering = true;
    error = null;
    try {
      const res = await api.get<{ ok: boolean; error?: string; repos?: FoundRepo[] }>(
        `/source-connections/${formProject.source_slug}/discover/repos?project=${encodeURIComponent(formProject.external_key)}`,
      );
      if (!res.ok) throw new Error(res.error ?? "discovery failed");
      found[formProject.id] = res.repos ?? [];
    } catch (e) {
      error = errText(e);
    } finally {
      discovering = false;
    }
  }

  function pickFound(r: FoundRepo) {
    form.url = r.url;
    if (r.default_branch) form.branch = r.default_branch;
    if (!form.slug)
      form.slug = r.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function openAdd() {
    editingSlug = null;
    form = {
      slug: "",
      url: "",
      source_project_id: knowledgeProjects[0]?.id ?? "",
      product_slug: "",
      component: "",
      branch: "main",
      extensions: "",
      max_file_kb: "",
    };
    showForm = true;
    void loadComponents(formProductSlug);
  }

  function openEdit(r: Repo) {
    editingSlug = r.slug;
    const cfg = r.config ?? {};
    form = {
      slug: r.slug,
      url: r.url,
      source_project_id: r.source_project_id ?? "",
      product_slug: r.product_slug ?? "",
      component: r.component_slug ?? "",
      branch: r.default_branch,
      extensions: (Array.isArray(cfg.include_extensions) ? cfg.include_extensions : []).join(", "),
      max_file_kb: cfg.max_file_kb == null ? "" : String(cfg.max_file_kb),
    };
    showForm = true;
    void loadComponents(r.product_slug ?? "");
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    error = null;
    try {
      const config: Record<string, unknown> = {};
      const ext = csv(form.extensions);
      if (ext.length) config.include_extensions = ext;
      if (form.max_file_kb.trim()) config.max_file_kb = Number(form.max_file_kb);
      await api.put("/repos", {
        slug: form.slug.trim(),
        url: form.url.trim(),
        ...(form.source_project_id ? { source_project_id: form.source_project_id } : {}),
        ...(formProductSlug ? { product: formProductSlug } : {}),
        component: form.component || null,
        branch: form.branch.trim() || "main",
        config,
      });
      showForm = false;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function reindex(r: Repo) {
    indexing = r.slug;
    error = null;
    try {
      await api.post(`/repos/${r.slug}/reindex`, {});
      await load();
    } catch (e) {
      error = errText(e);
    } finally {
      indexing = null;
    }
  }

  async function del(r: Repo) {
    error = null;
    try {
      await api.delete(`/repos/${r.slug}`);
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  // Indexing runs in the background on the server, so the table follows it.
  $effect(() => {
    if (busyIndex && !poll) poll = setInterval(load, 3000);
    if (!busyIndex && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  });

  $effect(() => {
    void loadComponents(formProductSlug);
  });

  onDestroy(() => poll && clearInterval(poll));
  onMount(load);
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<p class="muted hint">
  Linked repositories are cloned and indexed so the agent can ground answers in real
  code. Map each one to the component it implements — that is what lets a question
  about one part of the {t("product")} search that repo instead of all of them.
</p>

<h4>Repositories</h4>
<table>
  <thead><tr>
    <th class="tip" title={TIP.slug}>slug</th>
    <th>project</th>
    <th class="tip" title={TIP.repoComponent}>component</th>
    <th>branch</th>
    <th>index</th>
    <th>indexed</th>
    <th></th>
  </tr></thead>
  <tbody>
    {#each repos as r (r.id)}
      <tr>
        <td>{r.slug}<div class="muted url">{r.url}</div></td>
        <td class="muted">{r.project_key ?? r.product_slug ?? "—"}</td>
        <td>
          {#if r.component_slug}{r.component_slug}
          {:else}<span class="muted">unmapped</span>{/if}
        </td>
        <td class="muted">{r.default_branch}</td>
        <td>
          <span class="badge" class:on={r.index_status === "ready"}
            class:bad={r.index_status === "error"}>{r.index_status}</span>
        </td>
        <td class="muted">
          {freshness(r)}
          {#if r.file_count}<span class="counts">{r.file_count} files / {r.chunk_count} chunks</span>{/if}
        </td>
        <td class="actions">
          {#if canEditRepo(r)}
            <button class="mini" onclick={() => reindex(r)}
              disabled={indexing === r.slug || r.index_status === "cloning" || r.index_status === "indexing"}>
              {indexing === r.slug ? "…" : "reindex"}
            </button>
            <button class="icon-btn" title="edit" aria-label="edit" onclick={() => openEdit(r)}>✎</button>
            <DeleteButton onConfirm={() => del(r)} />
          {/if}
        </td>
      </tr>
      {#if r.index_error}
        <tr class="err-row"><td colspan="7"><span class="error">✕ {r.index_error}</span></td></tr>
      {/if}
    {/each}
    {#if !loading && repos.length === 0}
      <tr><td colspan="7" class="muted">No repositories linked yet.</td></tr>
    {/if}
  </tbody>
</table>

{#if canAdd}
  <div class="add-area">
    {#if !showForm}
      <button onclick={openAdd} disabled={!knowledgeProjects.length && !products.length}>+ link repository</button>
      {#if !knowledgeProjects.length}
        <span class="muted hint"> — register a knowledge project first, under Org › projects</span>
      {/if}
    {:else}
      <form class="repo-form" onsubmit={save}>
        <div class="add-form">
          <label>project
            <AsciiSelect bind:value={form.source_project_id}
              options={[{ value: "", label: "(none — scope by product)" },
                ...knowledgeProjects.map((p) => ({ value: p.id, label: `${p.external_key} (${p.product_slug})` }))]} />
          </label>
          {#if !form.source_project_id}
            <label>{t("product")}
              <AsciiSelect bind:value={form.product_slug}
                options={products.filter((p) => canCurateScope({ team_slug: p.team_slug }))
                  .map((p) => ({ value: p.slug, label: p.slug }))} />
            </label>
          {/if}
          {#if formProject}
            <button class="mini" type="button" onclick={discover} disabled={discovering}>
              {discovering ? "…" : "discover repos"}
            </button>
          {/if}
        </div>
        {#if formProject && (found[formProject.id] ?? []).length}
          <div class="chips">
            {#each found[formProject.id] as f (f.name)}
              <button class="chip" type="button" onclick={() => pickFound(f)}>{f.name}</button>
            {/each}
          </div>
        {/if}
        <div class="add-form">
          <label class="tip" title={TIP.slug}>slug
            <input bind:value={form.slug} required pattern="[a-z0-9][a-z0-9\-]*"
              disabled={!!editingSlug} placeholder="portal" />
          </label>
          <label>clone URL
            <input class="url-input" bind:value={form.url} required
              placeholder="https://dev.azure.com/org/project/_git/repo" />
          </label>
          <label class="tip" title={TIP.repoComponent}>component
            <AsciiSelect bind:value={form.component}
              options={[{ value: "", label: "(none)" },
                ...(components[formProductSlug] ?? []).map((c) => ({ value: c.slug, label: c.slug }))]} />
          </label>
          <label>branch
            <input class="short" bind:value={form.branch} placeholder="main" />
          </label>
        </div>
        <div class="add-form">
          <label class="tip" title="Only these file extensions are indexed. Leave empty for the built-in code allowlist.">
            extensions
            <input bind:value={form.extensions} placeholder="ts, cs, sql — optional" />
          </label>
          <label class="tip" title="Files larger than this are skipped (default 200).">
            max file KB
            <input class="short" bind:value={form.max_file_kb} placeholder="200" />
          </label>
          <button class="icon-btn ok" type="submit" title="save" aria-label="save" disabled={saving}>
            {saving ? "…" : "✓"}
          </button>
          <button class="icon-btn" type="button" title="cancel" aria-label="cancel"
            onclick={() => (showForm = false)}>↺</button>
        </div>
        <p class="muted hint">
          Cloning uses the project connection's stored token. Linking does not index —
          hit <em>reindex</em> once it is saved.
        </p>
      </form>
    {/if}
  </div>
{/if}

<style>
  .repo-form { display: flex; flex-direction: column; gap: 0.5rem; }
  .hint { font-size: 0.8rem; }
  .url { font-size: 0.75rem; opacity: 0.7; }
  .url-input { min-width: 22rem; }
  .short { min-width: 5rem; }
  .counts { display: block; font-size: 0.72rem; opacity: 0.7; }
  .err-row td { border-bottom: 1px solid var(--border); padding-top: 0; font-size: 0.8rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .chip { font-size: 0.75rem; padding: 0.1rem 0.5rem; }
</style>
