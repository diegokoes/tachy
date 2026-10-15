<script lang="ts">
  /**
   * Routes under /board:
   *   (none)                          the source's landing
   *   azure-devops                    the project last open
   *   azure-devops/:projectId         its items
   *   azure-devops/:projectId/:itemId one item
   */
  import { onMount } from "svelte";
  import type { WorkItemTypeOption } from "@tachy/contract";
  import { pushScope } from "../keys/keys.svelte";
  import { navigate, segment } from "../shell/router.svelte";
  import { setSubnav } from "../shell/subnav.svelte";
  import { AdoMark, EmptyState, Note, Select, Spinner } from "../tui";
  import { az, ensureProjects } from "./az.svelte";
  import { BOARD_SOURCE, boardListPath } from "./board";
  import { landingProject, rememberProject } from "./board.svelte";
  import { openComposer } from "./composer.svelte";
  import ItemDetail from "./ItemDetail.svelte";
  import ItemList from "./ItemList.svelte";
  import TypeMenu from "./TypeMenu.svelte";

  const projectId = $derived(segment(2) ?? "");
  const itemId = $derived(segment(3) ?? "");
  const project = $derived(az.projects?.find((p) => p.id === projectId));

  onMount(() => {
    void ensureProjects();
  });

  $effect(() => {
    if (segment(1) && projectId) return;
    const landing = az.projects ? landingProject() : null;
    if (landing) navigate(boardListPath(landing), { replace: true });
  });

  $effect(() => {
    if (project) rememberProject(project.id);
  });

  let typeMenu = $state<TypeMenu>();

  function startNew(type: WorkItemTypeOption) {
    if (!project) return;
    openComposer(project, type);
    navigate("/chat");
  }

  $effect(() =>
    setSubnav({
      items: [{ key: BOARD_SOURCE, label: "azure devops", mark: AdoMark }],
      active: BOARD_SOURCE,
      onpick: () => navigate(projectId ? boardListPath(projectId) : "/board"),
      actions: topRow,
    }),
  );

  $effect(() =>
    pushScope([
      { key: "n", label: "new item", run: () => typeMenu?.open() },
      ...(itemId
        ? [
            {
              key: "escape",
              label: "back to the list",
              run: () => navigate(boardListPath(projectId)),
            },
          ]
        : []),
    ]),
  );
</script>

{#snippet topRow()}
  <div class="top">
    <Select
      value={projectId}
      options={(az.projects ?? []).map((p) => ({
        value: p.id,
        label: p.name,
        hint: p.product_slug ?? p.team_slug,
      }))}
      placeholder="project"
      aria-label="project"
      onchange={(id) => navigate(boardListPath(String(id)))}
    />
    {#if project}
      <TypeMenu bind:this={typeMenu} projectId={project.id} onpick={startNew} />
    {/if}
  </div>
{/snippet}

{#if az.projectsError}
  <Note tone="danger">{az.projectsError}</Note>
{:else if !az.projects}
  <Spinner />
{:else if !az.projects.length}
  <EmptyState
    title="No Azure DevOps project yet."
    detail="An admin registers a team's projects under console › integrations."
  />
{:else if project && itemId}
  {#key itemId}
    <ItemDetail {project} {itemId} />
  {/key}
{:else if project}
  {#key project.id}
    <ItemList {project} />
  {/key}
{/if}

<style>
  .top {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
</style>
