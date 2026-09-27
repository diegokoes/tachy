<script lang="ts">
  import { RAMP } from "../tui";
  import { showSection } from "./overview";

  export type Count = {
    key: string;
    label: string;
    value?: number;
    /** Printed instead of `value`: a state, an age, a compacted figure. */
    text?: string;
    tone?: "accent" | "ok" | "warn" | "danger" | "muted";
    /** The section on this page this figure is the count of. */
    to?: string;
    /** What the figure is, in full, on hover. */
    title?: string;
  };

  let {
    items,
    loading = false,
  }: {
    items: Count[];
    loading?: boolean;
  } = $props();
</script>

{#snippet body(it: Count)}
  {#if loading}
    <span class="n skeleton" aria-label="loading">{RAMP[0].repeat(4)}</span>
  {:else}
    <span class="n {it.tone ?? 'accent'}">{it.text ?? (it.value ?? 0).toLocaleString()}</span>
  {/if}
  <span class="lbl">{it.label}</span>
{/snippet}

<div class="counts">
  {#each items as it (it.key)}
    {#if it.to}
      {@const to = it.to}
      <button class="cell go" title={it.title ?? `go to ${to}`} onclick={() => showSection(to)}>
        {@render body(it)}
      </button>
    {:else}
      <div class="cell" title={it.title}>{@render body(it)}</div>
    {/if}
  {/each}
</div>

<style>
  /* One row, never two: every counter gets an equal share of the width and a
     label that does not fit is cut, not wrapped onto a second line. */
  .counts {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--pad-4);
    width: 100%;
    min-width: 0;
  }

  .cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--pad-1);
    min-width: 0;
    padding: var(--pad-1) var(--pad-2);
    margin-left: calc(var(--pad-2) * -1);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  .cell.go {
    cursor: pointer;
  }
  .cell.go:hover,
  .cell.go:focus-visible {
    background: color-mix(in srgb, var(--muted) 12%, transparent);
  }

  .n {
    max-width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-fig);
    line-height: 1.1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .accent {
    color: var(--text);
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: var(--warn);
  }
  .danger {
    color: var(--danger);
  }
  .muted {
    color: var(--muted);
  }
  .skeleton {
    color: var(--border);
    letter-spacing: 0.1em;
    user-select: none;
  }

  .lbl {
    max-width: 100%;
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @container (max-width: 36rem) {
    .counts {
      grid-auto-flow: row;
      grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
    }
  }
</style>
