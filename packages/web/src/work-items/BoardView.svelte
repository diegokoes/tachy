<script lang="ts">
  /**
   * Routes under /board:
   *   (none)                          the source's landing
   *   azure-devops                    the project last open
   *   azure-devops/new                the composer, with the draft
   *   azure-devops/:projectId         its items
   *   azure-devops/:projectId/:itemId one item
   */
  import { onDestroy, onMount, tick } from "svelte";
  import type {
    ComposerProject,
    CreatedTicket,
    WorkItemTypeOption,
  } from "@tachy/contract";
  import { addEntry } from "../chat/chatState.svelte";
  import { pushScope } from "../keys/keys.svelte";
  import { navigate, segment } from "../shell/router.svelte";
  import { setSubnav } from "../shell/subnav.svelte";
  import { AdoMark, Button, EmptyState, Note, Spinner } from "../tui";
  import { az, refreshProjects } from "./az.svelte";
  import { BOARD_SOURCE, boardItemPath, boardListPath } from "./board";
  import { boardAsk, landingProject, rememberProject } from "./board.svelte";
  import { composer, openComposer } from "./composer.svelte";
  import ItemDetail from "./ItemDetail.svelte";
  import ItemList from "./ItemList.svelte";
  import TicketComposer from "./TicketComposer.svelte";
  import TypeMenu from "./TypeMenu.svelte";

  const composing = $derived(segment(2) === "new");
  const projectId = $derived(composing ? "" : (segment(2) ?? ""));
  const itemId = $derived(segment(3) ?? "");
  const project = $derived(
    composing ? composer.project : az.projects?.find((p) => p.id === projectId),
  );

  onMount(() => {
    void refreshProjects();
  });

  $effect(() => {
    if (segment(1) && (projectId || composing)) return;
    const landing = az.projects ? landingProject() : null;
    if (landing) navigate(boardListPath(landing), { replace: true });
  });

  $effect(() => {
    if (project) rememberProject(project.id);
  });

  let typeMenu = $state<TypeMenu>();

  // A tick late: the type menu closes on a route change, and the ask arrives
  // with one.
  $effect(() => {
    if (!boardAsk.newItem || !typeMenu) return;
    boardAsk.newItem = false;
    void tick().then(() => typeMenu?.open());
  });
  onDestroy(() => (boardAsk.newItem = false));

  function startNew(type: WorkItemTypeOption) {
    if (project) void openComposer(project, type);
  }

  function created(
    ticket: CreatedTicket,
    type: WorkItemTypeOption,
    from: ComposerProject,
  ) {
    if (composer.openedFrom === "chat")
      addEntry({ kind: "ticket", ticket, icon: type.icon, color: type.color });
    navigate(boardItemPath(from.id, String(ticket.id)));
  }

  $effect(() =>
    setSubnav({
      items: [{ key: BOARD_SOURCE, label: "azure", mark: AdoMark }],
      active: BOARD_SOURCE,
      onpick: () => navigate(project ? boardListPath(project.id) : "/board"),
      actions: topRow,
    }),
  );

  const backToList = () => navigate(boardListPath(projectId));

  $effect(() =>
    pushScope([
      { key: "n", run: () => typeMenu?.open() },
      ...(itemId ? [{ key: "esc", run: backToList }] : []),
    ]),
  );
</script>

{#snippet topRow()}
  <div class="top">
    {#if project && itemId}
      <Button size="sm" variant="ghost" icon="back" onclick={backToList}
        >{project.name}</Button
      >
    {/if}
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
    title="no Azure DevOps project yet"
    detail="an admin registers a team's projects under console › integrations"
  />
{:else if composing}
  <TicketComposer oncreated={created} />
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
