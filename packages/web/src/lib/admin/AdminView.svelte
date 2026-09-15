<script lang="ts">
  import { onMount, tick, untrack, type Component } from "svelte";
  import { navigate, segment } from "../router.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t, showCustomer } from "../terms";
  import { Button, Rail } from "../tui";
  import { setSubnav, setTopActions, type SubnavItem } from "../subnav.svelte";
  import { scrollport } from "../scrollport.svelte";
  import { topAction } from "./topAction.svelte";
  import { census } from "./census.svelte";
  import { createSpy, setActiveSpy } from "./scrollspy.svelte";
  import AdminSection from "./AdminSection.svelte";
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

  type Section = {
    key: string;
    label: string;
    view: Component;
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
      { key: "overview", label: "overview", view: PipelinePanel },
      { key: "sources", label: "sources", view: SourcesPanel, n: "sources", show: admin },
      { key: "projects", label: "projects", view: ProjectsPanel, n: "projects" },
      { key: "repos", label: "repos", view: ReposPanel, n: "repos" },
    ],
    structure: [
      { key: "overview", label: "overview", view: CatalogPanel },
      { key: "teams", label: t("teams"), view: TeamsPanel, n: "teams" },
      { key: "products", label: t("products"), view: ProductsPanel, n: "products" },
      { key: "components", label: "components", view: ComponentsPanel, n: "components" },
      { key: "labels", label: "labels", view: LabelsPanel, n: "labels" },
      { key: "patterns", label: "resolution patterns", view: PatternsPanel, n: "patterns" },
      { key: "customers", label: t("customers"), view: CustomersPanel, n: "customers", show: showCustomer() },
    ],
    access: [
      { key: "overview", label: "overview", view: PosturePanel },
      { key: "users", label: "users & roles", view: AccessPanel, n: "users" },
      { key: "credentials", label: "shared credentials", view: CredentialsPanel },
      { key: "system", label: "system settings", view: SystemPanel, show: admin },
    ],
  });

  const page = $derived(segment(1) ?? "connect");
  const sections = $derived(
    (SECTIONS[page] ?? SECTIONS.connect).filter((s) => s.show !== false),
  );

  /* Which rail row is lit. It follows the scroll, not the route — the route is
     what the scroll writes. Reading segment(2) here instead would close the
     loop and re-render the page on every section the reader passes. */
  let active = $state("");

  const spy = createSpy({
    onactive: (key) => {
      active = key;
      navigate(`/admin/${page}/${key}`, { replace: true });
    },
    order: () => sections.map((s) => s.key),
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

  /* One cheap query per page, not per section: every section on the page is on
     screen now, so there is no click left to recount on. */
  $effect(() => {
    page;
    census.reload();
  });

  /* Rebuilt per page, because the whole column of sections is replaced. The
     third segment is read here and nowhere else — as a place to open at, not as
     a thing to render from. */
  $effect(() => {
    page;
    const at = untrack(() => segment(2));
    let cancelled = false;
    tick().then(() => {
      if (cancelled) return;
      const first = sections[0]?.key ?? "";
      const target = sections.find((s) => s.key === at)?.key;
      /* The scroller is shared with every other view, so it still holds
         whatever the last page was scrolled to. Put it back at the top before
         the spy reads it, or arriving on a page lands halfway down it. */
      if (!target || target === first) {
        const port = scrollport();
        if (port) port.scrollTop = 0;
      }
      spy.start();
      active = target ?? first;
      if (target && target !== first) spy.goto(target, false);
    });
    return () => {
      cancelled = true;
      spy.destroy();
    };
  });

  /* Published for the overview cards, which scroll to the section that fixes
     whatever number they are showing. */
  onMount(() => {
    const drop = setActiveSpy(spy);
    return () => {
      drop();
      spy.destroy();
    };
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
  <Rail
    {items}
    {active}
    label="{page} sections"
    onpick={(k) => spy.goto(k)}
  />

  <div class="content">
    {#each sections as s (s.key)}
      <AdminSection
        {spy}
        section={s.key}
        label={s.label}
        view={s.view}
        eager={s.key === "overview"}
      />
    {/each}

    <!-- Air under the last section so it can be scrolled to the top like any
         other. Blank space is the price; the rail landing somewhere different
         depending on how many rows the last table holds was the alternative. -->
    <div class="tail" style="height: {spy.tail}px" aria-hidden="true"></div>
  </div>
</div>

<style>
  /* The index and everything it points at, in one column. The rail's active
     row is still the heading of the part you are in — it just tracks the
     scroll now instead of choosing what gets rendered at all. */
  .admin-root {
    display: grid;
    grid-template-columns: minmax(9rem, 12rem) 1fr;
    gap: var(--pad-4);
    align-items: start;
    min-width: 0;
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-width: 0;
  }
  .tail {
    flex: none;
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
