<script lang="ts">
  import type { Snippet } from "svelte";
  import InfoMark from "./InfoMark.svelte";

  let {
    label,
    info,
    error,
    required = false,
    inline = false,
    plain = false,
    wide = false,
    children,
  }: {
    label?: string;
    /** What the field is for and the rules behind it, behind the info mark.
     *  There is no second line under the control: prose there inflated every
     *  dialog it appeared in, and it always said what the mark already says. */
    info?: string;
    error?: string | null;
    required?: boolean;
    inline?: boolean;
    /** Renders as a div, for rows holding a value and its own button rather
     *  than one control — a <label> around a button steals its clicks. */
    plain?: boolean;
    /** Spans every column of the grid it is laid out in. */
    wide?: boolean;
    children: Snippet;
  } = $props();

  /* Reserved only where an error can actually appear, so showing one cannot
     shift the rows below it, and every other field keeps its height. */
  const errable = $derived(error !== undefined);
</script>

<svelte:element
  this={plain ? "div" : "label"}
  class="field"
  class:inline
  class:wide
  class:errable
>
  {#if label}
    <span class="lblrow">
      <span class="lbl"
        >{label}{#if required}<span class="req" aria-hidden="true">*</span>{/if}</span
      >
      {#if info}<InfoMark label="about {label}">{info}</InfoMark>{/if}
    </span>
  {/if}
  <span class="control">{@render children()}</span>
  {#if errable}
    <span class="note">{error ?? ""}</span>
  {/if}
</svelte:element>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
  }
  .field.wide {
    grid-column: 1 / -1;
  }

  .field.inline {
    flex-direction: row;
    align-items: center;
    gap: var(--gap);
  }
  .field.inline .lblrow {
    flex: none;
  }
  .field.inline .control {
    flex: 1;
    min-width: 0;
  }

  .lblrow {
    display: flex;
    align-items: center;
    gap: var(--pad-1);
    min-width: 0;
  }
  .lbl {
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .req {
    color: var(--accent);
    margin-left: 0.15em;
  }

  .control {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
  }
  /* A checkbox is its own size — stretching one to the field width leaves the
     box floating in the middle of an empty row. */
  .control > :global(input:not([type="checkbox"])),
  .control > :global(textarea) {
    width: 100%;
    min-width: 0;
  }

  .note {
    min-height: 1.15rem;
    font-size: var(--fs-xs);
    line-height: 1.15rem;
    color: var(--danger);
  }
</style>
