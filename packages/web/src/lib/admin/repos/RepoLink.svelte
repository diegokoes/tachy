<script lang="ts">
  import { api } from "../../api";
  import { ComponentCache } from "../../filing.svelte";
  import { keep, recall } from "../../kept";
  import { createResource, errText } from "../../resource.svelte";
  import { navigate } from "../../router.svelte";
  import { canCurateScope } from "../../session.svelte";
  import { slugify, uniqueSlug } from "../../slug";
  import { t } from "../../terms";
  import Group from "../../settings/Group.svelte";
  import Row from "../../settings/Row.svelte";
  import Rows from "../../settings/Rows.svelte";
  import { Button, Icon, Note, Select } from "../../tui";
  import { INFO } from "../help";
  import type { Customer, Product, Repo, SourceProject } from "../rows";
  import SourceFinder from "../SourceFinder.svelte";
  import { saveRepo } from "./draft";

  type FoundRepo = { name: string; url: string; default_branch: string };

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
  const customers = createResource(() => api.get<Customer[]>("/customers"), []);
  const components = new ComponentCache();

  void Promise.all([
    repos.reload(),
    projects.reload(),
    products.reload(),
    customers.reload(),
  ]);

  const mine = $derived(
    projects.data.filter(
      (p) => p.product_id && canCurateScope({ team_slug: p.team_slug }),
    ),
  );
  const myProducts = $derived(
    products.data.filter((p) => canCurateScope({ team_slug: p.team_slug })),
  );

  /* Null until someone picks, so the first project is offered rather than
     none; "" is a deliberate pick of no project. */
  let projectId = $state(
    recall<string | null>("admin.repos.link.project", null),
  );
  $effect(() => {
    if (projectId !== null) keep("admin.repos.link.project", projectId);
  });
  $effect(() => {
    if (
      mine.length &&
      (projectId === null ||
        (projectId && !mine.some((p) => p.id === projectId)))
    )
      projectId = mine[0].id;
  });
  let productSlug = $state("");
  let url = $state("");
  let branch = $state("main");
  let component = $state("");
  let customer = $state("");

  const project = $derived(mine.find((p) => p.id === projectId) ?? null);
  const product = $derived(project?.product_slug ?? productSlug);

  $effect(() => {
    if (product) void components.load(product);
  });

  let found = $state<Record<string, FoundRepo[]>>({});
  const hits = $derived(project ? found[project.id] : undefined);

  async function discover() {
    const p = project;
    if (!p) return;
    const res = await api.get<{
      ok: boolean;
      error?: string;
      repos?: FoundRepo[];
    }>(
      `/source-connections/${p.source_slug}/discover/repos?project=${encodeURIComponent(p.external_key)}`,
    );
    if (!res.ok) throw new Error(res.error ?? "discovery failed");
    found[p.id] = res.repos ?? [];
  }

  const linked = $derived(new Set(repos.data.map((r) => r.url)));
  const picked = $derived(hits?.find((h) => h.url === url)?.name ?? "");

  const slug = $derived(
    uniqueSlug(
      slugify(
        url
          .trim()
          .replace(/\.git$/, "")
          .split("/")
          .filter(Boolean)
          .pop() ?? "",
      ),
      repos.data.map((r) => r.slug),
    ),
  );

  const ready = $derived(Boolean(url.trim() && slug && (project || product)));

  let linking = $state(false);
  let error = $state<string | null>(null);

  async function link() {
    linking = true;
    error = null;
    try {
      await saveRepo(
        slug,
        {
          url,
          source_project_id: project?.id ?? "",
          product_slug: productSlug,
          customer_slug: customer,
          component_slug: component,
          default_branch: branch,
          lines: [],
          exclude: [],
          extensions: null,
          max_file_kb: "",
        },
        product,
      );
      navigate(`${LIST}/${slug}`);
    } catch (e) {
      error = errText(e);
    } finally {
      linking = false;
    }
  }

  const projectOptions = $derived([
    { value: "", label: `(none, scope by ${t("product")})` },
    ...mine.map((p) => ({
      value: p.id,
      label: p.external_key,
      hint: p.product_slug ?? undefined,
    })),
  ]);
</script>

<header class="bar">
  <span class="title">
    <Icon name="repo" size="1.1em" />
    <span class="name">link a repository</span>
  </span>
  <span class="acts">
    {#if error}<span class="bad">{error}</span>{/if}
    <Button variant="ghost" onclick={() => navigate(LIST)}>cancel</Button>
    <Button
      variant="primary"
      icon="plus"
      busy={linking}
      disabled={!ready}
      title={ready ? `link as ${slug}` : "pick a repo or paste its clone URL"}
      onclick={link}>link</Button
    >
  </span>
</header>

<div class="body">
  {#if !mine.length && !myProducts.length && !projects.loading && !products.loading}
    <Note>Nothing here you can link repos to.</Note>
  {:else}
    <Group label="project" icon="integrations">
      <Rows>
        <Row
          label="project"
          about="Owning project. Its connection supplies clone credentials and lists its repos."
        >
          <Select
            value={projectId ?? ""}
            options={projectOptions}
            searchable
            aria-label="project"
            onchange={(v) => (projectId = String(v ?? ""))}
          />
        </Row>
        {#if !project}
          <Row label={t("product")}>
            <Select
              value={productSlug}
              options={[
                { value: "", label: "(pick one)" },
                ...myProducts.map((p) => ({ value: p.slug, label: p.name })),
              ]}
              aria-label={t("product")}
              onchange={(v) => (productSlug = String(v ?? ""))}
            />
          </Row>
        {/if}
      </Rows>
    </Group>

    {#if project}
      {#key project.id}
        <SourceFinder
          source={project.external_key}
          label="fetch {project.external_key} repos"
          takenTip="already linked"
          empty="{project.external_key} shows no repos to this token"
          hits={hits?.map((h) => ({ key: h.name, name: h.name }))}
          {picked}
          registered={(name) =>
            linked.has(hits?.find((h) => h.name === name)?.url ?? "")}
          onfetch={discover}
          onpick={(g) => {
            const h = hits?.find((x) => x.name === g.key);
            if (!h) return;
            url = h.url;
            if (h.default_branch) branch = h.default_branch;
          }}
        />
      {/key}
    {/if}

    <Group label="repository" icon="repo">
      <Rows>
        <Row
          label="clone URL"
          about={project
            ? "Filled by picking a repo above, or pasted."
            : "Cloned with the token of the product's connection."}
        >
          <input
            bind:value={url}
            placeholder="https://…"
            aria-label="clone URL"
            spellcheck="false"
          />
        </Row>
        <Row
          label="default branch"
          about="Where releases land, usually master."
        >
          <input
            bind:value={branch}
            aria-label="default branch"
            spellcheck="false"
          />
        </Row>
        <Row label="component" about={INFO.repoComponent}>
          <Select
            value={component}
            options={[
              { value: "", label: "(none)" },
              ...components
                .of(product)
                .map((c) => ({ value: c.slug, label: c.name })),
            ]}
            searchable
            aria-label="component"
            onchange={(v) => (component = String(v ?? ""))}
          />
        </Row>
        <Row
          label="customer"
          about="Customer addon repos only. Empty: shared code, included in customer-scoped search."
        >
          <Select
            value={customer}
            options={[
              { value: "", label: "(none, shared)" },
              ...customers.data.map((c) => ({ value: c.slug, label: c.name })),
            ]}
            searchable
            aria-label="customer"
            onchange={(v) => (customer = String(v ?? ""))}
          />
        </Row>
      </Rows>
      {#if slug}
        <p class="quiet">
          Linked as <strong>{slug}</strong>. Folders, file types and release
          lines are set on its page before the first index.
        </p>
      {/if}
    </Group>
  {/if}
</div>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2) var(--pad-3);
    padding: var(--pad-3) 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel-solid);
  }
  /* The scrollport starts one --main-air above the bar's pinned edge, as
     under Section's heading; this covers that strip so rows never show over
     the bar. */
  .bar::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: var(--main-air, 0.65rem);
    background: var(--panel-solid);
  }
  .title {
    display: inline-flex;
    align-items: baseline;
    gap: var(--pad-2);
    color: var(--accent);
  }
  .name {
    font-weight: 600;
    color: var(--text);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin-left: auto;
  }
  .bad {
    color: var(--danger);
    font-size: var(--fs-sm);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: calc(var(--pad-4) * 1.5);
    width: min(100%, 40rem);
    margin: 0 auto;
    padding-top: var(--pad-4);
    --control-w: 18rem;
  }
  .quiet {
    margin: var(--pad-2) 0 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
