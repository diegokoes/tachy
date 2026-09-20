<script lang="ts">
  import type { Component } from "svelte";
  import { navigate, segment } from "../router.svelte";
  import { scrollport } from "../scrollport.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t, showCustomer } from "../terms";
  import { Button } from "../tui";
  import { setSubnav, setTopActions, type SubnavItem } from "../subnav.svelte";
  import SectionedPage, {
    type PageSection,
  } from "../sections/SectionedPage.svelte";
  import { sectionAction } from "./sectionAction.svelte";
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
  import JobsPanel from "./JobsPanel.svelte";
  import RuntimePanel from "./RuntimePanel.svelte";
  import JobsOverview from "./JobsOverview.svelte";
  import SystemOverview from "./SystemOverview.svelte";
  import IssuesModal from "./IssuesModal.svelte";
  import { issues, loadIssues } from "./issues.svelte";
  import { issueGroups } from "./issueMessages";
  import HostPanel from "./HostPanel.svelte";
  import TestsPanel from "./TestsPanel.svelte";

  type Section = Omit<PageSection, "count" | "tone"> & {
    /** Which census key counts this section. Omitted for a section with nothing to count. */
    n?: string;
    show?: boolean;
    /** The section's panel again, opened on one record at /<section>/<key>. */
    record?: Component<{ id: string }>;
  };

  const PAGES: SubnavItem[] = $derived([
    { key: "integrations", label: "integrations", icon: "link" },
    { key: "structure", label: "structure", icon: "layers" },
    { key: "access", label: "users", icon: "people" },
    ...(isGlobalAdmin()
      ? [
          { key: "workers", label: "workers", icon: "terminal" as const },
          { key: "system", label: "system", icon: "cog" as const },
        ]
      : []),
  ]);

  const admin = $derived(isGlobalAdmin());

  const SECTIONS: Record<string, Section[]> = $derived({
    integrations: [
      { key: "sources", label: "sources", view: SourcesPanel, record: SourcesPanel, n: "sources", show: admin },
      { key: "projects", label: "projects", view: ProjectsPanel, record: ProjectsPanel, n: "projects" },
      { key: "repos", label: "repos", view: ReposPanel, n: "repos" },
    ],
    structure: [
      { key: "teams", label: t("teams"), view: TeamsPanel, n: "teams" },
      { key: "products", label: t("products"), view: ProductsPanel, n: "products" },
      { key: "components", label: "components", view: ComponentsPanel, n: "components" },
      { key: "labels", label: "labels", view: LabelsPanel, n: "labels" },
      { key: "patterns", label: "resolution patterns", view: PatternsPanel, n: "patterns" },
      { key: "customers", label: t("customers"), view: CustomersPanel, record: CustomersPanel, n: "customers", show: showCustomer() },
    ],
    access: [
      { key: "users", label: "users & roles", view: AccessPanel, n: "users" },
    ],
    workers: [{ key: "jobs", label: "jobs", view: JobsPanel, record: JobsPanel, show: admin }],
    system: [
      { key: "runtime", label: "runtime", view: RuntimePanel, show: admin },
      { key: "host", label: "backups & host", view: HostPanel, show: admin },
      { key: "tests", label: "checks & load", view: TestsPanel, show: admin },
      { key: "settings", label: "settings", view: SystemPanel, show: admin },
    ],
  });

  const OVERVIEWS: Record<string, Component | undefined> = $derived({
    integrations: PipelinePanel,
    structure: CatalogPanel,
    access: PosturePanel,
    workers: admin ? JobsOverview : undefined,
    system: admin ? SystemOverview : undefined,
  });

  /* `connect` was the integrations page's old name; old links still land. */
  const page = $derived(
    segment(1) === "connect" ? "integrations" : (segment(1) ?? "integrations"),
  );

  const sections = $derived(
    (SECTIONS[page] ?? SECTIONS.integrations)
      .filter((s) => s.show !== false)
      .map(
        ({ n, show: _show, record: _record, ...s }): PageSection => ({
          ...s,
          count: n ? (census.loading ? null : (census.data.counts[n] ?? 0)) : undefined,
          tone: n && census.data.warn[n] ? ("warn" as const) : undefined,
          action: sectionAction(s.key),
        }),
      ),
  );

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
    void loadIssues(page);
  });

  const overview = $derived(OVERVIEWS[page]);
  const showing = $derived(Boolean(overview) && segment(2) === "overview");

  /* One record, on the page its section's rows open onto. It replaces the
     sections rather than sitting among them: the scroll-spy would otherwise
     rewrite the URL out from under it as the page scrolled. */
  const opened = $derived(segment(3));
  const Record = $derived.by(() => {
    if (!opened) return undefined;
    const s = (SECTIONS[page] ?? []).find((x) => x.key === segment(2));
    return s && s.show !== false ? s.record : undefined;
  });

  const toggleOverview = () =>
    navigate(`/admin/${page}${showing ? "" : "/overview"}`, { replace: true });

  /* A record claims the carved row for its own back and edit, and this takes
     it back once the record closes. */
  $effect(() => {
    if (Record) return;
    return setTopActions(topActions);
  });

  let showIssues = $state(false);
  const groups = $derived(issueGroups(issues.data));
  const issueTone = $derived(
    groups.some((g) => g.tone === "danger")
      ? ("danger" as const)
      : groups.length
        ? ("warn" as const)
        : undefined,
  );

  function pickSection(section: string) {
    showIssues = false;
    navigate(`/admin/${page}/${section}`);
  }

  $effect(() => {
    if (!showing && !opened) return;
    const port = scrollport();
    if (port) port.scrollTop = 0;
  });
</script>

{#snippet topActions()}
  {#if overview}
    <Button
      variant="ghost"
      size="sm"
      icon="overview"
      tone={showing ? "accent" : undefined}
      aria-pressed={showing}
      onclick={toggleOverview}>overview</Button
    >
  {/if}
  {#if groups.length}
    <Button
      variant="ghost"
      size="sm"
      icon="issues"
      tone={issueTone}
      title="{groups.length} open on this page"
      onclick={() => {
        showIssues = true;
        void loadIssues(page);
      }}>issues {groups.length}</Button
    >
  {/if}
{/snippet}

{#if showIssues}
  <IssuesModal
    {page}
    {groups}
    loading={issues.loading}
    error={issues.error}
    onpick={pickSection}
    onclose={() => (showIssues = false)}
  />
{/if}

<div class="admin-root" class:fit={showing && Boolean(overview)}>
  {#if Record && opened}
    {#key opened}
      <Record id={opened} />
    {/key}
  {:else if showing && overview}
    {@const View = overview}
    <View />
  {:else}
    <SectionedPage
      {sections}
      {page}
      label="{page} sections"
      at={segment(2)}
      onactive={(key) => navigate(`/admin/${page}/${key}`, { replace: true })}
    />
  {/if}
</div>

<style>
  /* While the overview shows, the page is exactly the window: the overview
     shares out the height itself instead of growing past it. */
  .admin-root.fit {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Chrome for the one panel still on hand-rolled markup: system settings.
     Deleted once it moves over. */
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
  .admin-root :global(.muted) {
    color: var(--muted);
  }
  .admin-root :global(.error) {
    color: var(--danger);
  }
</style>
