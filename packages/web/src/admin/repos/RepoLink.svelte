<script lang="ts">
  import { api } from "../../api";
  import { ComponentCache } from "../../library/filing.svelte";
  import { keep, recall } from "../../shell/kept";
  import { createResource, errText } from "../../resource.svelte";
  import { navigate } from "../../shell/router.svelte";
  import { canCurateScope } from "../../access/session.svelte";
  import { setPageActions } from "../pageActions.svelte";
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
    found[p.id] = [...(res.repos ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
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

  $effect(() => setPageActions(actions));
</script>

<!-- In admin's top tab beside the way back, which is also how a link is
     abandoned. -->
{#snippet actions()}
  <Button
    variant="ghost"
    tone="ok"
    size="sm"
    icon="plus"
    busy={linking}
    disabled={!ready}
    title={ready ? `link as ${slug}` : "pick a repo or paste its clone URL"}
    onclick={link}>link</Button
  >
{/snippet}

<div class="page">
  <h2 class="head">
    <span class="mark" aria-hidden="true"><Icon name="repo" size="1em" /></span>
    <span class="lbl">link a repository</span>
    <span class="rule" aria-hidden="true"></span>
    {#if error}<span class="bad">{error}</span>{/if}
  </h2>

  {#if !mine.length && !myProducts.length && !projects.loading && !products.loading}
    <Note>Nothing here you can link repos to.</Note>
  {:else}
    <!-- The finder holds two thirds whether or not it has answered, so the
         names land in a column that never changes width under them. -->
    <div class="layout">
      <div class="seek">
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
              below
              onpick={(g) => {
                const h = hits?.find((x) => x.name === g.key);
                if (!h) return;
                url = h.url;
                if (h.default_branch) branch = h.default_branch;
              }}
            />
          {/key}
        {/if}
      </div>

      <div class="col">
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
                    ...myProducts.map((p) => ({
                      value: p.slug,
                      label: p.name,
                    })),
                  ]}
                  aria-label={t("product")}
                  onchange={(v) => (productSlug = String(v ?? ""))}
                />
              </Row>
            {/if}
          </Rows>
        </Group>

        <Group label="repository" icon="repo">
          <Rows>
            <Row
              label="clone URL"
              about={project
                ? "Filled by picking a fetched repo, or pasted."
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
                  ...customers.data.map((c) => ({
                    value: c.slug,
                    label: c.name,
                  })),
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
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    --row-h: 1.5rem;
    --control-w: 16rem;
    padding-inline: var(--view-pad-x);
  }
  /* Set like a section heading on the repos page it opens from. */
  .head {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0 0 var(--pad-3);
    padding: var(--pad-2) 0;
    font-size: var(--fs-sm);
    font-weight: 500;
    letter-spacing: var(--label-spacing);
    background: var(--panel-bg);
  }
  .head::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: var(--main-air, 0.65rem);
    background: var(--panel-bg);
  }
  .mark {
    display: inline-flex;
    flex: none;
    color: var(--accent);
  }
  .lbl {
    flex: none;
    font-weight: 600;
    text-transform: uppercase;
  }
  .rule {
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .bad {
    color: var(--danger);
    font-size: var(--fs-sm);
    letter-spacing: normal;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    align-items: start;
    column-gap: calc(var(--pad-4) * 3);
    row-gap: var(--pad-4);
  }
  .seek {
    min-width: 0;
    --finder-air: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-width: 0;
  }
  .quiet {
    margin: var(--pad-2) 0 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  @media (max-width: 60rem) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .col {
      order: -1;
    }
  }
</style>
