<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    unsaved = false,
    action,
    children,
  }: {
    label: string;
    /** Holds an edit not saved yet. */
    unsaved?: boolean;
    /** Drawn at the heading's right, such as the button that edits it. */
    action?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section>
  <h3>
    <span class:unsaved>{label}</span>
    {#if unsaved}<span class="mark">unsaved</span>{/if}
    {#if action}<span class="action">{@render action()}</span>{/if}
  </h3>
  {@render children()}
</section>

<style>
  section {
    margin-top: var(--pad-4);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-height: 1.75rem;
    margin: 0 0 var(--pad-2);
    padding-bottom: var(--pad-1);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  .unsaved {
    color: var(--accent);
  }
  .mark {
    font-size: var(--fs-xs);
    text-transform: none;
    letter-spacing: normal;
    color: var(--accent);
  }
  .action {
    margin-left: auto;
  }
</style>
