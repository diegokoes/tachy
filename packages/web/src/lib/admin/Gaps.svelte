<script lang="ts">
  import { G } from "../tui";
  import { activeSpy } from "./scrollspy.svelte";

  export type Gap = {
    n: number;
    /** Reads after the number: "sources without a token". */
    label: string;
    tone?: "warn" | "danger";
    /** The section on this page that fixes it. */
    to: string;
  };

  let { items }: { items: Gap[] } = $props();

  /* Worst first, and nothing with a zero in it — a list of things that are
     fine is a list nobody reads. */
  const open = $derived(
    items
      .filter((g) => g.n > 0)
      .sort((a, b) => (a.tone === "danger" ? -1 : b.tone === "danger" ? 1 : 0)),
  );
</script>

{#if open.length}
  <ul class="gaps">
    {#each open as g (g.label)}
      <li>
        <button
          class={g.tone ?? "warn"}
          onclick={() => activeSpy()?.goto(g.to)}
          title="go to {g.to}"
        >
          <span class="n">{g.n.toLocaleString()}</span>
          <span class="lbl">{g.label}</span>
          <span class="go" aria-hidden="true">{G.right}</span>
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <span class="clear">nothing needs attention</span>
{/if}

<style>
  .gaps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    width: 100%;
    min-width: 0;
  }

  button {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: baseline;
    gap: var(--pad-2);
    width: 100%;
    padding: var(--pad-1) var(--pad-2);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    background: color-mix(in srgb, var(--muted) 12%, transparent);
    color: var(--text);
  }

  .n {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--tone-color);
  }
  .lbl {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .go {
    color: var(--tone-color);
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  button:hover .go,
  button:focus-visible .go {
    opacity: 1;
  }

  .warn {
    --tone-color: var(--warn);
  }
  .danger {
    --tone-color: var(--danger);
  }

  .clear {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
