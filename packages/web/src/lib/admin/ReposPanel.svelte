<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { keep, recall } from "../kept";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
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

  const components = new ComponentCache();
  let error = $state<string | null>(null);
  let indexing = $state<string | null>(null);
  let found = $state<Record<string, FoundRepo[]>>({});
  let discovering = $state(false);
  let poll: ReturnType<typeof setInterval> | undefined;

  const knowledgeProjects = $derived(
    projects.data.filter((p) => p.product_id),
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
      await gsap.to(section, { opacity: 0, y: -8, duration: 0.28, ease: "power2.in" });
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
      /* One row, one branch: the clone is --single-branch and repo_files is
         unique on (repo, path). Two branches means linking the repo twice. */
      info: "The one branch indexed. To index a second, link the repo again under another name.",
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
      title="clone this repo and re-read its files into the code index"
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
          onclick={() => discover(f.draft)}
          >ask {project.external_key}</Button
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
        <Chip tone="warn" onclick={() => (f.draft.extensions = "")}
          >clear</Chip
        >
      {/if}
    </div>
  </div>
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}
{@render indexErrors()}

<FilterBar
  bind:value={filter}
  shown={filtered.length}
  total={repos.data.length}
  placeholder="filter repos…"
  label="filter repositories"
/>

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
  formExtra={formExtra}
  oncreate={(d) => repos.mutate(() => save(d))}
  onsave={(_row, d) => repos.mutate(() => save(d))}
  ondelete={(r) => repos.mutate(() => api.delete(`/repos/${r.slug}`))}
/>

<style>
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
  .dim {
    color: var(--muted);
  }
</style>
