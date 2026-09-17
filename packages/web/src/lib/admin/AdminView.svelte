<script lang="ts">
  import { navigate, segment } from "../router.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t, showCustomer } from "../terms";
  import { Button } from "../tui";
  import { setSubnav, setTopActions, type SubnavItem } from "../subnav.svelte";
  import SectionedPage, {
    type PageSection,
  } from "../sections/SectionedPage.svelte";
  import { topAction } from "./topAction.svelte";
  import { census } from "./census.svelte";
  import { activity } from "./activity.svelte";
  import PipelinePanel from "./PipelinePanel.svelte";
  import CatalogPanel from "./CatalogPanel.svelte";
  import PosturePanel from "./PosturePanel.svelte";
  import SourcesPanel from "./SourcesPanel.svelte";
  import ProjectsPanel from "./ProjectsPanel.svelte";
  import ReposPanel from "./ReposPanel.svelte";
  import TeamsPanel from "./TeamsPanel.svelte";
  import ProductsPanel from "./ProductsPanel.svelte";
  import ComponentsPanel from "./ComponentsPanel.svelte";
  import LabelsPanel from "./LabelsPanel.svelte";
  import PatternsPanel from "./PatternsPanel.svelte";
  import CustomersPanel from "./CustomersPanel.svelte";
  import AccessPanel from "./AccessPanel.svelte";
  import SystemPanel from "./SystemPanel.svelte";
  import CredentialsPanel from "./CredentialsPanel.svelte";

  type Section = Omit<PageSection, "count" | "tone"> & {
    /** Which census key counts this section. Omitted for a section with nothing to count. */
    n?: string;
    show?: boolean;
  };

  const PAGES: SubnavItem[] = [
    { key: "connect", label: "connect", icon: "link" },
    { key: "structure", label: "structure", icon: "layers" },
    { key: "access", label: "access", icon: "key" },
  ];

  const admin = $derived(isGlobalAdmin());

  const SECTIONS: Record<string, Section[]> = $derived({
    connect: [
      { key: "overview", label: "overview", view: PipelinePanel, eager: true },
      { key: "sources", label: "sources", view: SourcesPanel, n: "sources", show: admin },
      { key: "projects", label: "projects", view: ProjectsPanel, n: "projects" },
      { key: "repos", label: "repos", view: ReposPanel, n: "repos" },
    ],
    structure: [
      { key: "overview", label: "overview", view: CatalogPanel, eager: true },
      { key: "teams", label: t("teams"), view: TeamsPanel, n: "teams" },
      { key: "products", label: t("products"), view: ProductsPanel, n: "products" },
      { key: "components", label: "components", view: ComponentsPanel, n: "components" },
      { key: "labels", label: "labels", view: LabelsPanel, n: "labels" },
      { key: "patterns", label: "resolution patterns", view: PatternsPanel, n: "patterns" },
      { key: "customers", label: t("customers"), view: CustomersPanel, n: "customers", show: showCustomer() },
    ],
    access: [
      { key: "overview", label: "overview", view: PosturePanel, eager: true },
      { key: "users", label: "users & roles", view: AccessPanel, n: "users" },
      { key: "credentials", label: "shared credentials", view: CredentialsPanel },
      { key: "system", label: "system settings", view: SystemPanel, show: admin },
    ],
  });

  const page = $derived(segment(1) ?? "connect");

  const sections = $derived(
    (SECTIONS[page] ?? SECTIONS.connect)
      .filter((s) => s.show !== false)
      .map(
        ({ n, show: _show, ...s }): PageSection => ({
          ...s,
          count: n ? (census.loading ? null : (census.data.counts[n] ?? 0)) : undefined,
          tone: n && census.data.warn[n] ? ("warn" as const) : undefined,
        }),
      ),
  );

  let active = $state("");

  $effect(() =>
    setSubnav({
      items: PAGES,
      active: page,
      onpick: (k) => navigate(`/admin/${k}`),
    }),
  );

  /* One cheap query per page, not per section: every section on the page is on
     screen now, so there is no click left to recount on. */
  $effect(() => {
    page;
    census.reload();
    activity.reload();
  });

  /* The section's own add button, drawn in the row carved out of the window's
     top edge. It follows the rail marker down the page. */
  const acting = $derived(topAction(active));
  $effect(() => (acting ? setTopActions(add) : undefined));
</script>

{#snippet add()}
  {@const a = acting}
  {#if a}
    <Button variant="ghost" tone="ok" size="sm" icon="plus" onclick={a.run}
      >{a.label}</Button
    >
  {/if}
{/snippet}

<div class="admin-root">
  <SectionedPage
    {sections}
    {page}
    bind:active
    label="{page} sections"
    at={segment(2)}
    onactive={(key) => navigate(`/admin/${page}/${key}`, { replace: true })}
  />
</div>

<style>
  /* Chrome for the two panels still on hand-rolled markup: system settings
     and shared credentials. Deleted as each one moves over. */
  .admin-root :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
    margin-bottom: var(--pad-3);
  }
  .admin-root :global(th),
  .admin-root :global(td) {
    text-align: left;
    padding: var(--pad-2) var(--pad-3);
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .admin-root :global(th) {
    color: var(--muted);
    font-weight: 500;
  }
  .admin-root :global(.tip) {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    cursor: help;
  }
  .admin-root :global(.mini) {
    font-size: var(--fs-xs);
    padding: var(--pad-1) var(--pad-3);
  }
  .admin-root :global(.muted) {
    color: var(--muted);
  }
  .admin-root :global(.error) {
    color: var(--danger);
  }
</style>
