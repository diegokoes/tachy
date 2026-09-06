<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import { createResource, errText } from "../resource.svelte";
  import { slugify, uniqueSlug } from "../slug";
  import {
    Badge,
    Button,
    Checkbox,
    Chip,
    CrudTable,
    FilterBar,
    ErrorMark,
    Field,
    Modal,
    Note,
    Subject,
    type Column,
    type Draft,
  } from "../tui";
  import type { Component, Customer, Product, Repo, SourceProject } from "./rows";
import { INFO } from "./help";
import { csv } from "../fields";
  import { claimTopAction } from "./topAction.svelte";

  type FoundRepo = { name: string; url: string; default_branch: string };

  const repos = createResource(
    () => api.get<{ repos: Repo[] }>("/repos").then((r) => r.repos),
    [],
  );
  const projects = createResource(
    () => api.get<SourceProject[]>("/source-projects"),
    [],
  );
  const products = createResource(() => api.get<Product[]>("/products"), []);
  const customers = createResource(
    () => api.get<Customer[]>("/customers"),
    [],
  );

  let components = $state<Record<string, Component[]>>({});
  let error = $state<string | null>(null);
  let indexing = $state<string | null>(null);
  let found = $state<Record<string, FoundRepo[]>>({});
  let discovering = $state(false);
  let poll: ReturnType<typeof setInterval> | undefined;

  const knowledgeProjects = $derived(
    projects.data.filter((p) => p.role === "knowledge"),
  );
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
  const busyIndex = $derived(
    repos.data.some(
      (r) => r.index_status === "cloning" || r.index_status === "indexing",
    ),
  );

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

  /* Bulk linking, because an Azure DevOps project routinely holds fifty repos
     and the single-repo form is one dialog each. Component and customer stay a
     per-repo decision afterwards — only the tedious part is batched. */
  let bulk = $state<{ project: SourceProject; picked: Set<string> } | null>(
    null,
  );
  let bulkBusy = $state(false);
  let bulkError = $state<string | null>(null);
  let bulkResults = $state<{ slug: string; ok: boolean; error?: string }[]>([]);
  let bulkFilter = $state("");

  const linkedUrls = $derived(new Set(repos.data.map((r) => r.url)));

  const bulkHits = $derived(bulk ? (found[bulk.project.id] ?? []) : []);
  const bulkShown = $derived(
    bulkFilter.trim()
      ? bulkHits.filter((r) =>
          r.name.toLowerCase().includes(bulkFilter.trim().toLowerCase()),
        )
      : bulkHits,
  );
  /** Already-linked rows render ticked and locked, so they are never a choice. */
  const bulkSelectable = $derived(
    bulkShown.filter((r) => !linkedUrls.has(r.url)),
  );
  /* Counted within the filter, not across the whole discovery: the bar
     describes what you are looking at. The confirm button carries the total. */
  const bulkPickedShown = $derived(
    bulk ? bulkSelectable.filter((r) => bulk!.picked.has(r.url)).length : 0,
  );

  async function openBulk(project: SourceProject) {
    bulkError = null;
    bulkResults = [];
    bulkFilter = "";
    bulk = { project, picked: new Set() };
    if (!found[project.id]) await discover({ source_project_id: project.id });
    const hits = found[project.id] ?? [];
    // Pre-tick everything not already linked: the normal intent is "all of them",
    // and un-ticking the few you don't want is less work than ticking fifty.
    bulk = {
      project,
      picked: new Set(
        hits.filter((r) => !linkedUrls.has(r.url)).map((r) => r.url),
      ),
    };
  }

  function toggleBulk(url: string, on: boolean) {
    if (!bulk) return;
    const picked = new Set(bulk.picked);
    if (on) picked.add(url);
    else picked.delete(url);
    bulk = { ...bulk, picked };
  }

  /** Acts on what the filter shows, so "…-api" then "all" is two actions. */
  function pickShown(on: boolean) {
    if (!bulk) return;
    const picked = new Set(bulk.picked);
    for (const r of bulkSelectable) {
      if (on) picked.add(r.url);
      else picked.delete(r.url);
    }
    bulk = { ...bulk, picked };
  }

  async function saveBulk() {
    if (!bulk) return;
    const hits = (found[bulk.project.id] ?? []).filter((r) =>
      bulk!.picked.has(r.url),
    );
    if (!hits.length) return;
    bulkBusy = true;
    bulkError = null;
    try {
      const taken = repos.data.map((r) => r.slug);
      const payload = hits.map((r) => {
        const slug = uniqueSlug(slugify(r.name), taken);
        taken.push(slug);
        return { slug, url: r.url, branch: r.default_branch || "main" };
      });
      const res = await api.put<{
        ok: boolean;
        results: { slug: string; ok: boolean; error?: string }[];
      }>("/repos/bulk", {
        source_project_id: bulk.project.id,
        repos: payload,
      });
      await repos.reload();
      bulkResults = res.results.filter((r) => !r.ok);
      if (res.ok) bulk = null;
    } catch (e) {
      bulkError = errText(e);
    } finally {
      bulkBusy = false;
    }
  }

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
      info: "The repo is cloned with the project connection's token.",
    },
    {
      key: "source_project_id",
      label: "project",
      width: "13rem",
      edit: "select",
      info: "Which registered project this repo belongs to. Its connection supplies the credentials that clone it.",
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
      info: "Only needed when the repo has no project. Ignored otherwise.",
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
      info: "Set this only for a customer's own addon repo. Left empty the repo is shared product code, and a customer-scoped search returns the shared ones too.",
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
        ...(components[productOfDraft(d)] ?? []).map((c) => ({
          value: c.slug,
          label: `${c.name} (${c.slug})`,
        })),
      ],
    },
    {
      key: "default_branch",
      label: "branch",
      width: "8rem",
      edit: "text",
      initial: "main",
    },
    {
      key: "extensions",
      label: "extensions",
      formOnly: true,
      edit: "text",
      info: "Comma-separated. Empty uses the built-in allowlist.",
      value: (r) =>
        (Array.isArray(r.config?.include_extensions)
          ? (r.config.include_extensions as string[])
          : []
        ).join(", "),
    },
    {
      key: "max_file_kb",
      label: "max file KB",
      formOnly: true,
      edit: "text",
      info: "Files larger than this are skipped. Empty means 200.",
      value: (r) => r.config?.max_file_kb ?? "",
    },
    { key: "index_status", label: "index", width: "8rem", cell: indexCell },
    { key: "indexed", label: "indexed", width: "10rem", cell: freshnessCell },
  ]);

  async function save(d: Draft) {
    const config: Record<string, unknown> = {};
    const ext = csv(String(d.extensions ?? ""));
    if (ext.length) config.include_extensions = ext;
    if (String(d.max_file_kb ?? "").trim())
      config.max_file_kb = Number(d.max_file_kb);
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
      config,
    });
  }

  async function reindex(r: Repo) {
    indexing = r.slug;
    error = null;
    try {
      await api.post(`/repos/${r.slug}/reindex`, {});
      await repos.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      indexing = null;
    }
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
    for (const p of myProducts) void loadComponents(p.slug);
  });

  onDestroy(() => poll && clearInterval(poll));
  onMount(reload);

  let filter = $state("");
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
  <span class:dim={!r.project_key}>{r.project_key ?? "—"}</span>
{/snippet}

{#snippet repoCell(r: Repo)}
  <span class="repo">
    {r.slug}
    <span class="url">{r.url}</span>
  </span>
{/snippet}

{#snippet indexCell(r: Repo)}
  <Badge
    tone={r.index_status === "ready"
      ? "ok"
      : r.index_status === "error"
        ? "danger"
        : "muted"}>{r.index_status}</Badge
  >
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
      title="reindex"
      busy={indexing === r.slug}
      disabled={r.index_status === "cloning" || r.index_status === "indexing"}
      onclick={() => reindex(r)}>index</Button
    >
  {/if}
{/snippet}

{#snippet indexErrors()}
  {#each repos.data.filter((r) => r.index_error) as r (r.id)}
    <ErrorMark message={r.index_error ?? ""} label={`${r.slug} index`} />
  {/each}
{/snippet}

{#snippet discoverField(f: {
  mode: "create" | "edit";
  row: Repo | null;
  draft: Draft;
})}
  {@const project = projectOf(String(f.draft.source_project_id ?? ""))}
  {@const hits = project ? (found[project.id] ?? []) : []}
  {#if project}
    <Field
      label="discover"
      info="Pick a repo instead of transcribing its clone URL."
    >
      <Button
        variant="ghost"
        size="sm"
        icon="discover"
        busy={discovering}
        onclick={() => discover(f.draft)}>discover</Button
      >
    </Field>
    {#if hits.length}
      <div class="chips">
        {#each hits as r (r.name)}
          <Chip
            tone={f.draft.url === r.url ? "accent" : "default"}
            onclick={() => {
              f.draft.url = r.url;
              if (r.default_branch) f.draft.default_branch = r.default_branch;
            }}>{r.name}</Chip
          >
        {/each}
      </div>
    {/if}
  {/if}
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}
{@render indexErrors()}

{#if knowledgeProjects.length}
  <div class="bulkbar">
    <span class="dim">link many at once from</span>
    {#each knowledgeProjects as p (p.id)}
      <Button
        variant="ghost"
        size="sm"
        icon="discover"
        disabled={!canCurateScope({ team_slug: p.team_slug })}
        onclick={() => openBulk(p)}>{p.external_key}</Button
      >
    {/each}
  </div>
{/if}

<FilterBar
  bind:value={filter}
  shown={filtered.length}
  total={repos.data.length}
  placeholder="filter repos…"
  label="filter repositories"
/>

<CrudTable
  hoist={claimTopAction}
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
  editTitle={(r) => r.slug}
  extraActions={reindexAction}
  formExtra={discoverField}
  oncreate={(d) => repos.mutate(() => save(d))}
  onsave={(_row, d) => repos.mutate(() => save(d))}
  ondelete={(r) => repos.mutate(() => api.delete(`/repos/${r.slug}`))}
/>

{#if bulk}
  {@const b = bulk}
  <Modal
    title={`link repos from ${b.project.external_key}`}
    width="56rem"
    busy={bulkBusy}
    confirmLabel={`link ${b.picked.size}`}
    confirmIcon="save"
    onConfirm={saveBulk}
    onCancel={() => (bulk = null)}
  >
    {#if bulkError}<Note tone="danger">{bulkError}</Note>{/if}
    <Subject verb="linking repos from" name={b.project.external_key} />
    {#if bulkResults.length}
      <Note tone="warn">
        {bulkResults.length} could not be linked:
        {bulkResults.map((r) => `${r.slug} (${r.error})`).join("; ")}
      </Note>
    {/if}
    {#if !bulkHits.length}
      <p class="dim">
        {discovering ? "asking the source…" : "no repos readable with this token"}
      </p>
    {:else}
      <p class="dim sm">Already linked ones are ticked and locked.</p>
      <div class="pickbar">
        <input
          placeholder="filter repos…"
          aria-label="filter repos"
          bind:value={bulkFilter}
          disabled={bulkBusy}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={bulkBusy || !bulkSelectable.length}
          onclick={() => pickShown(true)}>all</Button
        >
        <Button
          variant="ghost"
          size="sm"
          disabled={bulkBusy || !bulkSelectable.length}
          onclick={() => pickShown(false)}>none</Button
        >
        <span class="dim sm">
          {bulkPickedShown} of {bulkSelectable.length} selected
        </span>
      </div>
      <div class="picklist">
        {#each bulkShown as r (r.url)}
          {@const linked = linkedUrls.has(r.url)}
          <label class="prow" class:linked>
            <Checkbox
              ariaLabel={r.name}
              checked={linked || b.picked.has(r.url)}
              disabled={linked || bulkBusy}
              onchange={(on) => toggleBulk(r.url, on)}
            />
            <span class="pname">{r.name}</span>
            <span class="dim sm">{r.default_branch || "main"}</span>
            {#if linked}<Badge tone="muted">linked</Badge>{/if}
          </label>
        {/each}
        {#if !bulkShown.length}
          <p class="dim sm">nothing matches “{bulkFilter}”</p>
        {/if}
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .bulkbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--pad-1);
    margin-bottom: var(--pad-2);
    font-size: var(--fs-sm);
  }
  .pickbar {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin-bottom: var(--pad-2);
  }
  .pickbar input {
    flex: 1;
    min-width: 0;
  }

  /* A project routinely holds fifty repos — down one column that is a long
     scroll past the fold, across three it is a glance. */
  .picklist {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: var(--pad-1) var(--gap);
    max-height: min(28rem, 50vh);
    overflow-y: auto;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: var(--gap);
    min-width: 0;
    font-size: var(--fs-sm);
  }
  .prow.linked {
    color: var(--muted);
  }
  .pname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sm {
    font-size: var(--fs-xs);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
    margin-bottom: var(--pad-2);
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
  .dim {
    color: var(--muted);
  }
</style>
