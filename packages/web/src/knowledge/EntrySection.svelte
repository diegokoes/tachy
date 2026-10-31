<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    unsaved = false,
    active = false,
    compact = false,
    action,
    children,
  }: {
    label: string;
    /** Holds an edit not saved yet. */
    unsaved?: boolean;
    /** Being edited: the heading and its rule take the accent. */
    active?: boolean;
    /** A quieter heading, for the column beside the text. */
    compact?: boolean;
    /** Drawn at the heading's right, such as the button that adds a value. */
    action?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class:compact class:active>
  <h3>
    <span class="label" class:unsaved>{label}</span>
    {#if unsaved}<span class="mark">unsaved</span>{/if}
    {#if action}<span class="action">{@render action()}</span>{/if}
  </h3>
  {@render children()}
</section>

<style>
  section {
    margin-top: var(--pad-4);
  }
  /* The rule is a 1px background line over a transparent border, so it can
     turn into the accent gradient without the heading moving. */
  h3 {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-height: 1.75rem;
    margin: 0 0 var(--pad-2);
    padding-bottom: var(--pad-1);
    border-bottom: 1px solid transparent;
    background: linear-gradient(var(--border), var(--border)) left bottom / 100%
      1px no-repeat;
    font-size: var(--fs-sm);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  .unsaved,
  .active .label {
    color: var(--accent);
  }
  .active h3 {
    background-image: linear-gradient(90deg, var(--accent), transparent);
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
  .compact {
    margin-top: calc(var(--pad-4) * 1.5);
  }
  .compact h3 {
    font-size: var(--fs-xs);
    background-image: none;
  }
  .compact.active h3 {
    background-image: linear-gradient(90deg, var(--accent), transparent);
  }
</style>
