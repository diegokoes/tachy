<script lang="ts" module>
  export type CoverageGap = { text: string; tone: "warn" | "danger" };
  export type CoverageGroup = {
    key: string;
    label: string;
    detail?: string;
    /** What the table filter is set to when the group is picked. */
    filter?: string;
    gaps: CoverageGap[];
  };
</script>

<script lang="ts">
  import { G, Modal } from "../tui";

  let {
    groups,
    onpick,
    onclose,
  }: {
    groups: CoverageGroup[];
    onpick: (group: CoverageGroup) => void;
    onclose: () => void;
  } = $props();

  const toneOf = (g: CoverageGroup) =>
    g.gaps.some((x) => x.tone === "danger") ? "danger" : "warn";
</script>

<Modal
  title="coverage · projects"
  cancelLabel="close"
  width="36rem"
  onCancel={onclose}
>
  {#if !groups.length}
    <p class="quiet">
      Nothing outstanding. Fetch projects when registering one to check for any
      that were never picked up.
    </p>
  {:else}
    <ul class="groups">
      {#each groups as group (group.key)}
        <li class="group {toneOf(group)}">
          <button
            class="head"
            disabled={!group.filter}
            onclick={() => onpick(group)}
          >
            <span class="mark" aria-hidden="true"></span>
            <span class="text">{group.label}</span>
            {#if group.detail}<span class="detail">{group.detail}</span>{/if}
            {#if group.filter}<span class="go" aria-hidden="true"
                >{G.right}</span
              >{/if}
          </button>
          <ul class="items">
            {#each group.gaps as gap, i (i)}
              <li class={gap.tone}>{gap.text}</li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  .groups {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    max-height: calc(100dvh - 24rem);
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }

  .head {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: baseline;
    gap: var(--pad-2);
    width: 100%;
    padding: var(--pad-1) var(--pad-2);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .head:disabled {
    cursor: default;
  }
  .head:not(:disabled):hover,
  .head:focus-visible {
    background: color-mix(in srgb, var(--muted) 12%, transparent);
  }
  .mark {
    align-self: center;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 1px;
    background: var(--tone-color);
  }
  .text {
    font-family: var(--font-mono);
  }
  .detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .go {
    font-size: var(--fs-xs);
    color: var(--muted);
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .head:hover .go,
  .head:focus-visible .go {
    opacity: 1;
  }

  .items {
    list-style: none;
    margin: 0 0 0 calc(var(--pad-2) + 0.25rem);
    padding: 0 0 0 var(--pad-3);
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-left: 1px solid
      color-mix(in srgb, var(--tone-color) 45%, transparent);
    font-size: var(--fs-xs);
  }
  .items li {
    padding: 2px var(--pad-2);
  }
  .items li.danger {
    color: var(--danger);
  }

  .quiet {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  .warn {
    --tone-color: var(--warn);
  }
  .danger {
    --tone-color: var(--danger);
  }
</style>
