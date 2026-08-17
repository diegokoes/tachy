<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    hint,
    error,
    required = false,
    inline = false,
    children,
  }: {
    label?: string;
    hint?: string;
    error?: string | null;
    required?: boolean;
    inline?: boolean;
    children: Snippet;
  } = $props();

  const note = $derived(error || hint || "");
</script>

<!-- The note line is ALWAYS in the layout, so showing a validation error can
     never change the field's height and shift the rows below it. -->
<label class="field" class:inline class:noted={Boolean(hint || error)}>
  {#if label}
    <span class="lbl"
      >{label}{#if required}<span class="req" aria-hidden="true">*</span>{/if}</span
    >
  {/if}
  <span class="control">{@render children()}</span>
  {#if hint || error}
    <span class="note" class:err={Boolean(error)}>{note}</span>
  {/if}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
  }

  .field.inline {
    flex-direction: row;
    align-items: center;
    gap: var(--gap);
  }
  .field.inline .lbl {
    flex: none;
  }
  .field.inline .control {
    flex: 1;
    min-width: 0;
  }

  .lbl {
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
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
  .control > :global(input),
  .control > :global(textarea) {
    width: 100%;
    min-width: 0;
  }

  .note {
    min-height: 1.15rem;
    font-size: var(--fs-xs);
    line-height: 1.15rem;
    color: var(--muted);
  }
  .note.err {
    color: var(--danger);
  }
</style>
