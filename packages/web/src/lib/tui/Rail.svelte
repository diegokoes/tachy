<script lang="ts">
  import { jellyPress } from "../motion";
  import { G } from "./glyphs";

  export type RailItem = {
    key: string;
    label: string;
    /** null while it is still being counted. Omit for sections that have no count. */
    count?: number | null;
    /** Paints the count, for a section holding something that wants attention. */
    tone?: "warn" | "danger";
  };

  let {
    items,
    active,
    onpick,
    label = "sections",
  }: {
    items: RailItem[];
    active: string;
    onpick: (key: string) => void;
    label?: string;
  } = $props();
</script>

<!-- The index for one section of the app: what is in here, how much of it
     there is, and which part you are looking at. It is not a third tab bar —
     it answers "what can I configure here", which a bar of labels alone never
     did, and it is why each part can now have the window to itself. -->
<nav class="rail" aria-label={label}>
  {#each items as it (it.key)}
    {@const on = it.key === active}
    <button
      class="row"
      class:on
      aria-current={on ? "page" : undefined}
      onclick={() => onpick(it.key)}
      use:jellyPress
    >
      <span class="mark" aria-hidden="true">{on ? G.marker : " "}</span>
      <span class="lbl">{it.label}</span>
      {#if it.count !== undefined}
        <span class="n" class:pending={it.count === null} class:warn={it.tone === "warn"} class:danger={it.tone === "danger"}
          >{it.count ?? "·"}</span
        >
      {/if}
    </button>
  {/each}
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    /* Sticky rather than scrolling away: losing the index the moment you use
       it is the thing this replaces. */
    position: sticky;
    top: 0;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    width: 100%;
    min-width: 0;
    padding: var(--pad-2) var(--pad-2);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    color: var(--muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    cursor: pointer;
  }
  .row:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--muted) 12%, transparent);
  }
  .row.on {
    color: var(--text);
    background: var(--accent-dim);
  }
  .row:focus-visible {
    outline: none;
    border-color: var(--accent);
  }

  .mark {
    flex: none;
    width: 0.6em;
    font-family: var(--font-mono);
    color: var(--accent);
  }
  .lbl {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: var(--label-spacing);
  }
  .n {
    flex: none;
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .row.on .n {
    color: var(--text);
  }
  .n.pending {
    opacity: 0.6;
  }
  .row .n.warn {
    color: var(--warn);
  }
  .row .n.danger {
    color: var(--danger);
  }

  /* Below this the column costs more width than the content can spare, so the
     index lies down and scrolls sideways above it. */
  @media (max-width: 52rem) {
    .rail {
      position: static;
      flex-direction: row;
      gap: var(--pad-1);
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: var(--pad-1);
      border-bottom: 1px solid var(--border);
    }
    .rail::-webkit-scrollbar {
      display: none;
    }
    .row {
      width: auto;
      flex: none;
    }
    .mark {
      display: none;
    }
  }
</style>
