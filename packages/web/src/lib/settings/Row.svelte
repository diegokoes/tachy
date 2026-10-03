<script lang="ts">
  import type { Snippet } from "svelte";
  import { tip } from "../tui";

  let {
    label,
    hint,
    about,
    mark,
    children,
    actions,
  }: {
    label: string;
    /** Sits under the label. */
    hint?: string;
    /** Said on hover over the label, for what would crowd it as a hint. */
    about?: string;
    /** A badge set after the label, on its line. */
    mark?: Snippet;
    children: Snippet;
    /** Reset marks, source notes: whatever qualifies the control, set just
     *  ahead of it so the control itself keeps the right edge. */
    actions?: Snippet;
  } = $props();
</script>

<!-- One setting: its name against the left edge, its control against the
     right, so every name in a group starts on one line and every control ends
     on another. A column too narrow for both drops the control under the name,
     still flush right. -->
<div class="row">
  <div class="k">
    {#if mark}
      <span class="line">
        <span class="name" use:tip={about}>{label}</span>{@render mark()}
      </span>
    {:else}
      <span class="name" use:tip={about}>{label}</span>
    {/if}
    {#if hint}<span class="hint">{hint}</span>{/if}
  </div>
  <div class="end">
    {#if actions}<div class="a">{@render actions()}</div>{/if}
    <div class="v">{@render children()}</div>
  </div>
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    column-gap: var(--gap);
    row-gap: var(--pad-1);
    min-height: var(--row-h);
    padding: var(--pad-1) 0;
  }
  .k {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 0 7rem;
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--pad-2);
  }
  .name {
    font-size: var(--fs-xs);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--muted);
    opacity: 0.75;
  }
  .end {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--pad-2);
    flex: 0 1 auto;
    min-width: 0;
    margin-left: auto;
  }
  .a {
    display: flex;
    align-items: center;
    gap: var(--pad-1);
  }
  .v {
    display: flex;
    justify-content: flex-end;
    min-width: 0;
  }
  /* Menus and text boxes share one width, so the controls down a group line
     up on their left edges as well as their right. */
  .v > :global(.asel),
  .v > :global(input),
  .v > :global(.field) {
    width: var(--control-w, 12rem);
    max-width: 100%;
  }
</style>
