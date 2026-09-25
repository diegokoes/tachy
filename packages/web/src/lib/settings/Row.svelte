<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    hint,
    children,
    actions,
  }: {
    label: string;
    /** Sits under the control, in the control's column. */
    hint?: string;
    children: Snippet;
    /** Reset marks, source notes — whatever trails the control. */
    actions?: Snippet;
  } = $props();
</script>

<!-- One setting, unframed. The label column is what lines the page up; a box
     around each option was only ever restating that they are separate, which
     the column already says. The trailing 1fr takes the slack so the marks sit
     against the control instead of against the window's right edge. -->
<div class="row">
  <span class="k">{label}</span>
  <div class="v">
    {@render children()}
    {#if hint}<p class="hint">{hint}</p>{/if}
  </div>
  <div class="a">{#if actions}{@render actions()}{/if}</div>
  <span></span>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 10rem minmax(0, 22rem) auto 1fr;
    gap: var(--gap);
    align-items: start;
    min-height: var(--row-h);
    padding: var(--pad-1) 0;
  }
  /* Centred in its own box rather than given the row's line-height: a label
     long enough to wrap — "Claude subscription token" — dropped its second line
     past the control it names. */
  .k {
    display: flex;
    align-items: center;
    min-height: var(--row-h);
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .v {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--pad-2);
    min-width: 0;
    min-height: var(--row-h);
  }
  .a {
    display: flex;
    align-items: center;
    gap: var(--pad-1);
    min-height: var(--row-h);
  }
  .hint {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  @media (max-width: 40rem) {
    .row {
      grid-template-columns: 1fr auto;
    }
    .v {
      grid-column: 1 / -1;
    }
  }
</style>
