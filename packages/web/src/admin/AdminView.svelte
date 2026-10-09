<script lang="ts">
  import { onDestroy, type Component } from "svelte";
  import { navigate, segment } from "../shell/router.svelte";
  import { keep, recall } from "../shell/kept";
  import { scrollport } from "../shell/scrollport.svelte";
  import { isGlobalAdmin } from "../access/session.svelte";
  import { t, showCustomer } from "../terms";
  import { Button } from "../tui";
  import {
    setSubnav,
    setTopActions,
    type SubnavItem,
  } from "../shell/subnav.svelte";
  import SectionedPage, {
    type PageSection,
  } from "../sections/SectionedPage.svelte";
  import { sectionActions } from "./sectionAction.svelte";
  import { pageActions } from "./pageActions.svelte";
  import FillSection from "./FillSection.svelte";
  import { census } from "./census.svelte";
  import { activity } from "./activity.svelte";
  import PipelinePanel from "../sources/PipelinePanel.svelte";
  import CatalogPanel from "../catalog/CatalogPanel.svelte";
  import PosturePanel from "../access/PosturePanel.svelte";
  import SourcesPanel from "../sources/SourcesPanel.svelte";
  import ProjectsPanel from "../sources/ProjectsPanel.svelte";
  import ReposPanel from "../code/ReposPanel.svelte";
  import RepoDetail from "../code/RepoDetail.svelte";
  import BucketsPanel from "../buckets/BucketsPanel.svelte";
  import BulkLink from "../code/BulkLink.svelte";
  import TeamsPanel from "../catalog/TeamsPanel.svelte";
  import ProductsPanel from "../catalog/ProductsPanel.svelte";
  import ComponentsPanel from "../catalog/ComponentsPanel.svelte";
  import CoverageMap from "../catalog/CoverageMap.svelte";
  import LabelsPanel from "../catalog/LabelsPanel.svelte";
  import PatternsPanel from "../catalog/PatternsPanel.svelte";
  import CustomersPanel from "../catalog/CustomersPanel.svelte";
  import AccessPanel from "../access/AccessPanel.svelte";
  import TeamRosterPanel from "../access/TeamRosterPanel.svelte";
  import AppAdminsPanel from "../access/AppAdminsPanel.svelte";
  import SystemPanel from "../system/SystemPanel.svelte";
  import JobsPanel from "../jobs/JobsPanel.svelte";
  import RunsPanel from "../jobs/RunsPanel.svelte";
  import QueuesPanel from "../jobs/QueuesPanel.svelte";
  import WorkersPanel from "../jobs/WorkersPanel.svelte";
  import JobFailuresPanel from "../jobs/JobFailuresPanel.svelte";
  import RuntimePanel from "../system/RuntimePanel.svelte";
  import JobsOverview from "../jobs/JobsOverview.svelte";
  import SystemOverview from "../system/SystemOverview.svelte";
  import ReportsPanel from "../reports/ReportsPanel.svelte";
  import IssuesModal from "./IssuesModal.svelte";
  import SectionModal from "./SectionModal.svelte";
  import { issues, loadIssues } from "./issues.svelte";
  import { issueGroups } from "./issueMessages";
  import { closeTile, expandedKey } from "./expand.svelte";
  import { setPeriod } from "./period.svelte";
  import HostPanel from "../system/HostPanel.svelte";
  import ChecksPanel from "../diagnostics/ChecksPanel.svelte";
  import LoadsPanel from "../diagnostics/LoadsPanel.svelte";
  import FlowsPanel from "../flows/FlowsPanel.svelte";

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
    /** What opens in the window for one record of the section, at /console/<page>/<section>/<id>. */
    detail?: Component;
  };

  const PAGES: SubnavItem[] = $derived([
    { key: "integrations", label: "integrations", icon: "integrations" },
    { key: "structure", label: "structure", icon: "structure" },
    { key: "access", label: "users", icon: "users" },
    { key: "flows", label: "flows", icon: "flows" },
    { key: "workers", label: "jobs", icon: "workers" },
    { key: "system", label: "system", icon: "system" },
  ]);

  const admin = $derived(isGlobalAdmin());

  const SECTIONS: Record<string, Section[]> = $derived({
    flows: [
      {
        key: "forms",
        label: "ticket forms",
        view: FlowsPanel,
        fill: true,
      },
    ],
    integrations: [
      {
        key: "sources",
        label: "sources",
        view: SourcesPanel,
        n: "sources",
      },
      {
        key: "projects",
        label: "projects",
        icon: "project",
        view: ProjectsPanel,
        n: "projects",
      },
      {
        key: "repos",
        label: "repos",
        icon: "repo",
        view: ReposPanel,
        n: "repos",
        detail: RepoDetail,
      },
      {
        key: "buckets",
        label: "buckets",
        view: BucketsPanel,
        n: "buckets",
        present: "modal",
      },
      { key: "bulk-link", label: "bulk link", view: BulkLink, fill: true },
    ],
    structure: [
      {
        key: "teams",
        label: t("teams"),
        view: TeamsPanel,
        n: "teams",
      },
      {
        key: "products",
        label: t("products"),
        view: ProductsPanel,
        n: "products",
      },
      {
        key: "components",
        label: "components",
        view: ComponentsPanel,
        n: "components",
        fill: true,
      },
      {
        key: "map",
        label: "entries per component",
        view: CoverageMap,
        fill: true,
      },
      {
        key: "labels",
        label: "labels",
        view: LabelsPanel,
        n: "labels",
      },
      {
        key: "patterns",
        label: "resolution patterns",
        view: PatternsPanel,
        n: "patterns",
      },
      {
        key: "customers",
        label: t("customers"),
        view: CustomersPanel,
        n: "customers",
        show: showCustomer(),
      },
    ],
    access: [
      {
        key: "users",
        label: "users",
        icon: "users",
        view: AccessPanel,
        n: "users",
      },
      {
        key: "teams",
        label: t("teams"),
        view: TeamRosterPanel,
        n: "teams",
      },
      {
        key: "admins",
        label: "app admins",
        view: AppAdminsPanel,
      },
    ],
    workers: [
      {
        key: "jobs",
        label: "schedule",
        icon: "jobs",
        view: JobsPanel,
      },
      {
        key: "runs",
        label: "runs",
        icon: "runs",
        view: RunsPanel,
      },
      {
        key: "queues",
        label: "queues",
        icon: "queues",
        view: QueuesPanel,
      },
      {
        key: "processes",
        label: "workers",
        icon: "workerPool",
        view: WorkersPanel,
      },
      {
        key: "failures",
        label: "failed jobs",
        view: JobFailuresPanel,
        present: "modal",
      },
    ],
    // All dialogs: the overview carries the summary of each, which is the page,
    // and a counter or tile opens the full detail behind it.
    system: [
      {
        key: "reports",
        label: "reports",
        view: ReportsPanel,
        n: "reports",
        show: admin,
      },
      {
        key: "runtime",
        label: "runtime",
        view: RuntimePanel,
        present: "modal",
      },
      {
        key: "host",
        label: "backups & host",
        view: HostPanel,
        present: "modal",
      },
      {
        key: "checks",
        label: "checks",
        view: ChecksPanel,
        present: "modal",
      },
      {
        key: "loads",
        label: "load tests",
        view: LoadsPanel,
        present: "modal",
      },
      {
        key: "settings",
        label: "runtime settings",
        view: SystemPanel,
        present: "modal",
      },
    ],
  });

  const OVERVIEWS: Record<string, Component | undefined> = $derived({
    flows: undefined,
    integrations: PipelinePanel,
    structure: CatalogPanel,
    access: PosturePanel,
    workers: JobsOverview,
    system: SystemOverview,
  });

  // Links to `connect`, the integrations page's former slug, still land.
  const page = $derived(
    segment(1) === "connect" ? "integrations" : (segment(1) ?? "integrations"),
  );

  const live = $derived(
    (SECTIONS[page] ?? SECTIONS.integrations).filter((s) => s.show !== false),
  );

  /** Undefined for a section that counts nothing, null while the census loads. */
  function countOf(key: string | undefined) {
    if (!key) return undefined;
    return census.loading ? null : (census.data.counts[key] ?? 0);
  }

  /**
   * The one section open in the window, when the route names one that opens
   * there. Only that one is rendered: a page section is a destination reached
   * from a counter, not one stop in a long scroll.
   */
  const sections = $derived(
    live
      .filter((s) => s.present !== "modal" && s.key === segment(2))
      .map(
        ({
          n,
          show: _show,
          present: _present,
          fill: _fill,
          detail: _detail,
          ...rest
        }): PageSection => ({
          ...rest,
          count: countOf(n),
          tone: n && census.data.warn[n] ? ("warn" as const) : undefined,
          actions: sectionActions(rest.key),
        }),
      ),
  );

  $effect(() =>
    setSubnav({
      items: PAGES,
      active: page,
      onpick: (k) => navigate(`/console/${k}`),
    }),
  );

  const overview = $derived(OVERVIEWS[page]);
  const at = $derived(segment(2));

  /** The section open over the overview, if the one named opens that way. */
  const modal = $derived(
    live.find((s) => s.key === at && s.present === "modal"),
  );

  // Anything that is not a window section lands on the overview: nothing named,
  // /overview, a dialog section, or a key no section has.
  const showing = $derived(Boolean(overview) && !sections.length);

  // Recount on landing on a page and whenever its overview comes back into view
  // with nothing over it. Sections are left by a button, a dialog's close or
  // the browser's back alike, so the recount hangs on the route.
  const resting = $derived(showing && !modal);
  let counted: string | undefined;
  $effect(() => {
    const landed = page !== counted;
    const back = resting;
    counted = page;
    if (!landed && !back) return;
    census.reload();
    activity.reload();
    void loadIssues(page);
  });

  const filled = $derived(live.find((s) => s.fill && s.key === at));

  /** The record open in the window, when the route names one under its section. */
  const detail = $derived(
    segment(3) ? live.find((s) => s.detail && s.key === at) : undefined,
  );

  // Settle the explicit form back on the short one. This cannot loop: after the
  // replace, segment(2) is undefined and the condition stops holding.
  $effect(() => {
    if (segment(2) === "overview")
      navigate(`/console/${page}`, { replace: true });
  });

  const expanded = $derived(expandedKey());

  // The window a detail view was set to belongs to that view: leaving it by any
  // route, the back button or a tab, puts every overview on its default.
  $effect(() => {
    if (!expanded) setPeriod(undefined);
  });
  onDestroy(() => setPeriod(undefined));

  const backToOverview = () => navigate(`/console/${page}`);

  // A page without an overview has nothing to show until a section is named, so
  // it opens on its first.
  $effect(() => {
    if (!overview && !segment(2) && live[0])
      navigate(`/console/${page}/${live[0].key}`, { replace: true });
  });

  $effect(() => setTopActions(topActions));

  let showIssues = $state(recall("admin.issues", false));
  $effect(() => keep("admin.issues", showIssues));
  const groups = $derived(issueGroups(issues.data));
  const issueTone = $derived.by(() => {
    if (groups.some((g) => g.tone === "danger")) return "danger" as const;
    return groups.length ? ("warn" as const) : undefined;
  });

  function pickSection(section: string) {
    showIssues = false;
    navigate(`/console/${page}/${section}`);
  }

  $effect(() => {
    if (!showing) return;
    const port = scrollport();
    if (port) port.scrollTop = 0;
  });
</script>

{#snippet topActions()}
  <!-- Only on the way back: going in is a click on a counter, and a modal
       section carries its own close. -->
  {#if detail}
    <Button
      variant="ghost"
      size="sm"
      icon="back"
      onclick={() => navigate(`/console/${page}/${detail.key}`)}
      >{detail.label}</Button
    >
  {:else if overview && !showing}
    <Button variant="ghost" size="sm" icon="back" onclick={backToOverview}
      >overview</Button
    >
  {:else if overview && expanded}
    <Button
      variant="ghost"
      size="sm"
      icon="back"
      onclick={() => closeTile(page)}>overview</Button
    >
  {/if}
  {#if detail || filled}
    {@render pageActions()?.()}
  {/if}
  <!-- Issues belong to the page as a whole, so only its overview raises them. -->
  {#if showing && !expanded && groups.length}
    <Button
      variant="ghost"
      size="sm"
      icon="issues"
      tone={issueTone}
      onclick={() => {
        showIssues = true;
        void loadIssues(page);
      }}>issues {groups.length}</Button
    >
  {/if}
{/snippet}

{#if showIssues && showing}
  <IssuesModal
    {page}
    {groups}
    loading={issues.loading}
    error={issues.error}
    onpick={pickSection}
    onclose={() => (showIssues = false)}
  />
{/if}

<div
  class="admin-root admin-tables"
  class:fit={(showing && Boolean(overview)) || Boolean(filled)}
>
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
  {:else if detail?.detail}
    {@const Detail = detail.detail}
    <Detail />
  {:else}
    <SectionedPage
      {sections}
      {page}
      label="{page} sections"
      at={segment(2)}
      onactive={(key) => navigate(`/console/${page}/${key}`, { replace: true })}
    />
  {/if}
</div>

<style>
  /* While the overview shows, the page is as tall as the window: the
     overview shares out the height itself instead of growing past it. */
  .admin-root.fit {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Chrome for the panels on hand-rolled tables: runtime, host and settings.
     Keyed on a class, not .admin-root, since those panels open in dialogs
     mounted on <body>. SectionModal wears the class too. */
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
