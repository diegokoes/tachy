<script lang="ts">
  import { onMount, type Component } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { navigate, segment } from "../router.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t, showCustomer } from "../terms";
  import { Button, Rail } from "../tui";
  import { setSubnav, setTopActions } from "../subnav.svelte";
  import { topAction } from "./topAction.svelte";
  import PipelinePanel from "./PipelinePanel.svelte";
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

  type Census = {
    counts: Record<string, number>;
    warn: Record<string, number>;
  };

  type Section = {
    key: string;
    label: string;
    view: Component;
    /** Which census key counts this section. Omitted for a section with nothing to count. */
    n?: string;
    show?: boolean;
  };

  const PAGES = [
    { key: "connect", label: "connect" },
    { key: "structure", label: "structure" },
    { key: "access", label: "access" },
  ];

  const admin = $derived(isGlobalAdmin());

  const SECTIONS: Record<string, Section[]> = $derived({
    connect: [
      { key: "overview", label: "overview", view: PipelinePanel },
      { key: "sources", label: "sources", view: SourcesPanel, n: "sources", show: admin },
      { key: "projects", label: "projects", view: ProjectsPanel, n: "projects" },
      { key: "repos", label: "repos", view: ReposPanel, n: "repos" },
    ],
    structure: [
      { key: "teams", label: t("teams"), view: TeamsPanel, n: "teams" },
      { key: "products", label: t("products"), view: ProductsPanel, n: "products" },
      { key: "components", label: "components", view: ComponentsPanel, n: "components" },
      { key: "labels", label: "labels", view: LabelsPanel, n: "labels" },
      { key: "patterns", label: "resolution patterns", view: PatternsPanel, n: "patterns" },
      { key: "customers", label: t("customers"), view: CustomersPanel, n: "customers", show: showCustomer() },
    ],
    access: [
      { key: "users", label: "users & roles", view: AccessPanel, n: "users" },
      { key: "credentials", label: "shared credentials", view: CredentialsPanel },
      { key: "system", label: "system settings", view: SystemPanel, show: admin },
    ],
  });

  const page = $derived(segment(1) ?? "connect");
  const sections = $derived(
    (SECTIONS[page] ?? SECTIONS.connect).filter((s) => s.show !== false),
  );

  /* An unknown third segment, or one the caller has no permission for, lands
     on the page's first section rather than an empty column. */
  const current = $derived(
    sections.find((s) => s.key === segment(2)) ?? sections[0],
  );

  const census = createResource(() => api.get<Census>("/overview"), {
    counts: {},
    warn: {},
  });

  const items = $derived(
    sections.map((s) => ({
      key: s.key,
      label: s.label,
      count: s.n
        ? census.loading
          ? null
          : (census.data.counts[s.n] ?? 0)
        : undefined,
      tone: s.n && census.data.warn[s.n] ? ("warn" as const) : undefined,
    })),
  );

  $effect(() =>
    setSubnav({
      items: PAGES,
      active: page,
      onpick: (k) => navigate(`/admin/${k}`),
    }),
  );

  /* Recounted on every section change rather than by each panel reporting its
     own writes: one cheap query, and the index is never stale by more than the
     click it took to get here. */
  $effect(() => {
    current?.key;
    census.reload();
  });

  onMount(() => census.reload());

  /* The section's own add button, drawn in the row carved out of the window's
     top edge. Admin was the one section leaving that corner empty. */
  $effect(() => (topAction() ? setTopActions(add) : undefined));
</script>

{#snippet add()}
  {@const a = topAction()}
  {#if a}
    <Button variant="ghost" tone="ok" size="sm" icon="plus" onclick={a.run}
      >{a.label}</Button
    >
  {/if}
{/snippet}

<div class="admin-root">
  <Rail
    {items}
    active={current?.key ?? ""}
    label="{page} sections"
    onpick={(k) => navigate(`/admin/${page}/${k}`)}
  />

  <div class="content">
    {#if current}
      {@const View = current.view}
      <View />
    {/if}
  </div>
</div>

<style>
  /* The index and the one section it points at. No panel around the section:
     the rail's active row is its heading, and a title straddling a border on
     top of that only ever said the same thing twice. */
  .admin-root {
    display: grid;
    grid-template-columns: minmax(9rem, 12rem) 1fr;
    gap: var(--pad-4);
    align-items: start;
    min-width: 0;
  }
  .content {
    min-width: 0;
  }

  @media (max-width: 52rem) {
    .admin-root {
      grid-template-columns: 1fr;
      gap: var(--pad-3);
    }
  }

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
