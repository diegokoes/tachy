<script lang="ts">
  import { Chip } from "../tui";
  import { growBar } from "../motion";
  import { fill, type Item } from "./items";

  let {
    item,
    selected = false,
    delay = 0,
    el = $bindable(),
    onopen,
    onfocus,
    onhover,
  }: {
    item: Item;
    /** Whether the list cursor is on this row. */
    selected?: boolean;
    /** Stagger for the relevance gauge, from the row's position. */
    delay?: number;
    /** The button itself, so the list can scroll the cursor into view. */
    el?: HTMLElement;
    onopen: () => void;
    onfocus: () => void;
    onhover: () => void;
  } = $props();
</script>

    <button
      class="row {item.kind}"
      class:cursor={selected}
      bind:this={el}
      onclick={onopen}
      onfocus={onfocus}
      onmouseenter={onhover}
    >
      {#if item.relevance != null}
        <span
          class="gauge {item.grade ?? 'weak'}"
          role="meter"
          aria-valuenow={Math.round(item.relevance * 100)}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="match"
          title="{item.grade ?? 'weak'} match, {Math.round(
            item.relevance * 100,
          )}%"
        >
          <span
            class="fill"
            use:growBar={{
              pct: fill(item.relevance),
              delay,
            }}
          ></span>
        </span>
      {/if}

      <span class="body">
        <span class="line">
          <span class="title">{item.title}</span>
          <span class="tr">
            {#if item.version}<span class="ver">{item.version}</span>{/if}
          </span>
        </span>
        {#if item.snippet}
          <span class="snippet"
            >{#each item.snippet as s}{#if s.hit}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}</span
          >
        {/if}
        <span class="foot">
          <span class="tags">
            {#if item.customer}
              <Chip
                tone="accent"
                title="specific to this customer's install, not general product behaviour"
                >{item.customer}</Chip
              >
            {/if}
            {#each item.tags as tag}<Chip>{tag}</Chip>{/each}
          </span>
          <span class="state {item.status}">{item.status}</span>
          <span class="stamp">
            {#if item.updated}<span>updated {item.updated}</span>{/if}
          </span>
        </span>
      </span>
    </button>

<style>
  .row {
    width: 100%;
    text-align: left;
    display: flex;
    align-items: stretch;
    gap: var(--pad-3);
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: var(--panel);
    border: 1px solid transparent;
    border-left: 3px solid var(--kind);
    border-radius: var(--radius);
    padding: var(--pad-3);
  }
  .row.entry {
    --kind: var(--accent);
  }
  .row.doc {
    --kind: var(--doc);
  }
  /* An article is curated rather than imported, so it reads as its own shelf. */
  .row.article {
    --kind: var(--ok, var(--accent));
  }
  /* Only `.cursor` paints — hovering MOVES the cursor rather than lighting a
     second card, so there is exactly one highlight and the pointer and the
     keyboard share one position. */
  .row.cursor,
  .row:focus-visible {
    outline: none;
    border-color: var(--accent);
    border-left-color: var(--kind);
    background: var(--accent-dim);
  }

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
  }
  .line {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: start;
    gap: var(--pad-3);
  }

  /* The track runs the full height of the card, so a card with a preview
     simply gets a longer bar. The tiers stay at fixed PERCENTAGES — that is
     the shared reference — and are cut out in the page color so they read as
     notches through the fill. */
  .gauge {
    position: relative;
    flex: none;
    min-height: 1.4rem;
    width: 5px;
    background: color-mix(in srgb, var(--muted) 26%, transparent);
    border-radius: 2px;
    overflow: hidden;
  }
  .gauge::before,
  .gauge::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    z-index: 1;
    background: var(--gauge-tick);
  }
  .gauge::before {
    bottom: 35%;
  }
  .gauge::after {
    bottom: 70%;
  }
  .fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 0;
    border-radius: 2px;
    background: var(--muted);
  }
  .gauge.good .fill {
    background: var(--accent);
  }
  .gauge.strong .fill {
    background: var(--ok);
  }
  .title {
    font-weight: 500;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .tr {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-xs);
    color: var(--muted);
    white-space: nowrap;
  }
  .ver {
    color: var(--kind);
  }

  .snippet {
    color: var(--muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .snippet mark {
    background: var(--accent-dim);
    color: var(--text);
  }

  /* Equal side tracks keep the status centred on the card, not between
     whatever the tags and the date happen to weigh. */
  .foot {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: baseline;
    gap: var(--pad-3);
    margin-top: auto;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .tags {
    display: flex;
    align-items: baseline;
    gap: var(--pad-1);
    flex-wrap: wrap;
    min-width: 0;
  }
  .stamp {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    justify-self: end;
    white-space: nowrap;
  }

  /* Status reads at a glance but never competes with the title: each tone is
     mixed halfway into --muted. */
  .state {
    letter-spacing: var(--label-spacing);
    white-space: nowrap;
    color: var(--muted);
  }
  .state.approved {
    color: color-mix(in srgb, var(--ok) 55%, var(--muted));
  }
  .state.draft {
    color: color-mix(in srgb, var(--accent) 55%, var(--muted));
  }
  .state.deprecated {
    color: color-mix(in srgb, var(--warn) 55%, var(--muted));
  }
  .state.rejected {
    color: color-mix(in srgb, var(--danger) 55%, var(--muted));
  }
  .state.archived {
    color: var(--muted);
    opacity: 0.75;
  }
</style>
