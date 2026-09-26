<script lang="ts">
  import type { Component } from "svelte";
  import { navigate, segment } from "../router.svelte";
  import { keep, recall } from "../kept";
  import { scrollport } from "../scrollport.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t, showCustomer } from "../terms";
  import { Button } from "../tui";
  import { setSubnav, setTopActions, type SubnavItem } from "../subnav.svelte";
  import SectionedPage, {
    type PageSection,
  } from "../sections/SectionedPage.svelte";
  import { sectionAction } from "./sectionAction.svelte";
  import FillSection from "./FillSection.svelte";
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
  import TeamRosterPanel from "./TeamRosterPanel.svelte";
  import AppAdminsPanel from "./AppAdminsPanel.svelte";
  import SystemPanel from "./SystemPanel.svelte";
  import JobsPanel from "./JobsPanel.svelte";
  import JobFailuresPanel from "./JobFailuresPanel.svelte";
  import RuntimePanel from "./RuntimePanel.svelte";
  import JobsOverview from "./JobsOverview.svelte";
  import SystemOverview from "./SystemOverview.svelte";
  import ReportsPanel from "./ReportsPanel.svelte";
  import IssuesModal from "./IssuesModal.svelte";
  import SectionModal from "./SectionModal.svelte";
  import { issues, loadIssues } from "./issues.svelte";
  import { issueGroups } from "./issueMessages";
  import HostPanel from "./HostPanel.svelte";
  import ChecksPanel from "./ChecksPanel.svelte";
  import LoadsPanel from "./LoadsPanel.svelte";

  type Section = Omit<PageSection, "count" | "tone"> & {
    /** Which census key counts this section. Omitted for a section with nothing to count. */
    n?: string;
    show?: boolean;
    /**
     * Where the section opens. A handful of rows belongs over the overview,
     * where the counters stay readable behind it; a list that runs to fifty
     * wants the window. Defaults to the window.
     */
    present?: "modal" | "page";
    /** A page section that takes the whole window, edge to edge, and never scrolls. */
    fill?: boolean;
  };

  const PAGES: SubnavItem[] = $derived([
    { key: "integrations", label: "integrations", icon: "integrations" },
    { key: "structure", label: "structure", icon: "structure" },
    { key: "access", label: "users", icon: "users" },
    ...(isGlobalAdmin()
      ? [
          { key: "workers", label: "workers", icon: "workers" as const },
          { key: "system", label: "system", icon: "system" as const },
        ]
      : []),
  ]);

  const admin = $derived(isGlobalAdmin());

  const SECTIONS: Record<string, Section[]> = $derived({
    integrations: [
      { key: "sources", label: "sources", view: SourcesPanel, n: "sources", show: admin, present: "modal" },
      { key: "projects", label: "projects", view: ProjectsPanel, n: "projects", present: "modal" },
      { key: "repos", label: "repos", view: ReposPanel, n: "repos" },
    ],
    structure: [
      { key: "teams", label: t("teams"), view: TeamsPanel, n: "teams", present: "modal" },
      { key: "products", label: t("products"), view: ProductsPanel, n: "products", present: "modal" },
      { key: "components", label: "components", view: ComponentsPanel, n: "components", fill: true },
      { key: "labels", label: "labels", view: LabelsPanel, n: "labels", present: "modal" },
      { key: "patterns", label: "resolution patterns", view: PatternsPanel, n: "patterns", present: "modal" },
      { key: "customers", label: t("customers"), view: CustomersPanel, n: "customers", show: showCustomer() },
    ],
    access: [
      { key: "users", label: "users", view: AccessPanel, n: "users" },
      { key: "teams", label: t("teams"), view: TeamRosterPanel, n: "teams", present: "modal" },
      { key: "admins", label: "app admins", view: AppAdminsPanel, present: "modal" },
    ],
    workers: [
      { key: "jobs", label: "jobs", view: JobsPanel, show: admin },
      { key: "failures", label: "failed jobs", view: JobFailuresPanel, show: admin, present: "modal" },
    ],
    /* All dialogs: the overview carries the summary of each, which is the
       page, and a counter or tile opens the full detail behind it. */
    system: [
      { key: "reports", label: "reports", view: ReportsPanel, n: "reports", show: admin },
      { key: "runtime", label: "runtime", view: RuntimePanel, show: admin, present: "modal" },
      { key: "host", label: "backups & host", view: HostPanel, show: admin, present: "modal" },
      { key: "checks", label: "checks", view: ChecksPanel, show: admin, present: "modal" },
      { key: "loads", label: "load tests", view: LoadsPanel, show: admin, present: "modal" },
      { key: "settings", label: "runtime settings", view: SystemPanel, show: admin, present: "modal" },
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

  const live = $derived(
    (SECTIONS[page] ?? SECTIONS.integrations).filter((s) => s.show !== false),
  );

  /**
   * The one section open in the window, when the route names one that opens
   * there. Only that one is rendered: a page section is a destination reached
   * from a counter, not one stop in a long scroll.
   */
  const sections = $derived(
    live
      .filter((s) => s.present !== "modal" && s.key === segment(2))
      .map(
        ({ n, show: _show, present: _present, fill: _fill, ...s }): PageSection => ({
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
  const at = $derived(segment(2));

  /** The section open over the overview, if the one named opens that way. */
  const modal = $derived(live.find((s) => s.key === at && s.present === "modal"));

  /* Anything that is not a window section lands on the overview: nothing
     named, /overview, a dialog section, or a key no section has. */
  const showing = $derived(Boolean(overview) && !sections.length);

  const filled = $derived(live.find((s) => s.fill && s.key === at));

  /* Settle the explicit form back on the short one. This cannot loop: after
     the replace, segment(2) is undefined and the condition stops holding. */
  $effect(() => {
    if (segment(2) === "overview") navigate(`/admin/${page}`, { replace: true });
  });

  const backToOverview = () => navigate(`/admin/${page}`);

  $effect(() => setTopActions(topActions));

  let showIssues = $state(recall("admin.issues", false));
  $effect(() => keep("admin.issues", showIssues));
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
    if (!showing) return;
    const port = scrollport();
    if (port) port.scrollTop = 0;
  });
</script>

{#snippet topActions()}
  <!-- Only on the way back. Going in is the counter you clicked, and a modal
       section carries its own close. -->
  {#if overview && !showing}
    <Button variant="ghost" size="sm" icon="back" onclick={backToOverview}
      >overview</Button
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

<div class="admin-root admin-tables" class:fit={(showing && Boolean(overview)) || Boolean(filled)}>
  {#if showing && overview}
    {@const View = overview}
    <View />
    {#if modal}
      <SectionModal
        section={modal.key}
        label={modal.label}
        view={modal.view}
        onclose={backToOverview}
      />
    {/if}
  {:else if filled}
    <FillSection view={filled.view} />
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

  /* Chrome for the panels still on hand-rolled tables: runtime, host and
     settings. Keyed on a class rather than on .admin-root because those
     panels open in dialogs, and a dialog is mounted on <body>, outside
     .admin-root entirely. SectionModal wears the same class. */
  :global(.admin-tables table) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
    margin-bottom: var(--pad-3);
  }
  :global(.admin-tables th),
  :global(.admin-tables td) {
    text-align: left;
    padding: var(--pad-2) var(--pad-3);
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  :global(.admin-tables th) {
    color: var(--muted);
    font-weight: 500;
  }
  :global(.admin-tables .tip) {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    cursor: help;
  }
  :global(.admin-tables .muted) {
    color: var(--muted);
  }
  :global(.admin-tables .error) {
    color: var(--danger);
  }
</style>
