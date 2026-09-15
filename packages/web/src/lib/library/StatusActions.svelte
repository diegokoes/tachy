<script lang="ts">
  import { Button } from "../tui";
  import type { StatusAction } from "./status";

  /**
   * An item's lifecycle actions, drawn as a labelled column in the margin left
   * of the reading measure. Which of them apply depends on the current status,
   * so the column is taken out of flow: an entry moving from approved to
   * archived drops two buttons and grows another, and in flow that walked the
   * title and the whole body up and down the page.
   */
  let { actions }: { actions: StatusAction[] } = $props();
</script>

{#if actions.length}
  <div class="rail">
    {#each actions as a (a.label)}
      <Button
        variant="ghost"
        size="sm"
        icon={a.icon}
        tone={a.tone}
        title={a.title ?? a.label}
        disabled={a.disabled}
        onclick={a.onclick}>{a.label}</Button
      >
    {/each}
  </div>
{/if}

<style>
  .rail {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--pad-1);
    width: max-content;
  }
  /* Marks in one column, labels in another: a ragged left edge on five ghost
     buttons reads as five unrelated controls. */
  .rail :global(.btn) {
    justify-content: flex-start;
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }

  /* No margin left to sit in — the column rejoins the flow above the content
     rather than printing itself over the first paragraph. */
  @media (max-width: 68rem) {
    .rail {
      position: static;
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: center;
      width: auto;
      margin-bottom: var(--pad-3);
    }
  }
</style>
