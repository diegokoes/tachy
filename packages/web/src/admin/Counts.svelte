<script lang="ts">
  import { RAMP } from "../tui";
  import { groupCounts, showSection, type Count } from "./overview";

  let {
    items,
    loading = false,
  }: {
    items: Count[];
    loading?: boolean;
  } = $props();

  const groups = $derived(groupCounts(items));

  // A breakdown that goes where its parent goes adds no target of its own, so
  // the whole group is one click rather than buttons inside a button.
  const merged = (head: Count, parts: Count[]) =>
    parts.every((p) => !p.to || p.to === head.to);
</script>

{#snippet figure(it: Count)}
  {#if loading}
    <span class="n skeleton" aria-label="loading">{RAMP[0].repeat(4)}</span>
  {:else}
    <span class="n {it.tone ?? 'accent'}"
      >{it.text ?? (it.value ?? 0).toLocaleString()}</span
    >
  {/if}
  <span class="lbl">{it.label}</span>
{/snippet}

{#snippet part(it: Count)}
  <span class="pn {it.tone ?? 'accent'}"
    >{loading
      ? RAMP[0].repeat(2)
      : (it.text ?? (it.value ?? 0).toLocaleString())}</span
  >
  <span class="pl">{it.label}</span>
{/snippet}

{#snippet parts(list: Count[])}
  <span class="parts">
    {#each list as p (p.key)}
      {#if p.to}
        {@const to = p.to}
        <button class="part go" onclick={() => showSection(to)}
          >{@render part(p)}</button
        >
      {:else}
        <span class="part">{@render part(p)}</span>
      {/if}
    {/each}
  </span>
{/snippet}

{#snippet plain(list: Count[])}
  <span class="parts">
    {#each list as p (p.key)}
      <span class="part">{@render part(p)}</span>
    {/each}
  </span>
{/snippet}

<div class="counts">
  {#each groups as g (g.head.key)}
    {@const head = g.head}
    {@const to = head.to}
    <div
      class="group"
      class:split={g.parts.length > 0}
      style="--w: {1 + g.parts.length * 0.35}"
    >
      {#if g.parts.length && to && merged(head, g.parts)}
        <button class="cell go" onclick={() => showSection(to)}>
          <span class="main">{@render figure(head)}</span>
          {@render plain(g.parts)}
        </button>
      {:else}
        {#if to}
          <button class="cell go" onclick={() => showSection(to)}>
            <span class="main">{@render figure(head)}</span>
          </button>
        {:else}
          <div class="cell">
            <span class="main">{@render figure(head)}</span>
          </div>
        {/if}
        {#if g.parts.length}{@render parts(g.parts)}{/if}
      {/if}
    </div>
  {/each}
</div>

<style>
  /* One row, never two: every counter gets a share of the width and a label
     that does not fit is cut, not wrapped onto a second line. A counter with a
     breakdown takes the room of the figures beside it. */
  .counts {
    display: flex;
    gap: var(--pad-4);
    width: 100%;
    min-width: 0;
  }

  .group {
    flex: var(--w) 1 0;
    min-width: 0;
    display: flex;
    align-items: stretch;
  }
  .group.split {
    --part-gap: calc(var(--pad-4) * 1.5);
    padding-left: var(--pad-3);
  }
  .group.split:first-child {
    padding-left: 0;
  }
  /* The strip ends on its last breakdown, so that group sits against the
     right edge instead of leaving the slack after it. */
  .group.split:last-child {
    justify-content: flex-end;
  }

  .cell {
    display: flex;
    align-items: flex-start;
    gap: var(--pad-3);
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
  .group:not(.split) .cell {
    flex: 1 1 0;
    flex-direction: column;
    gap: var(--pad-1);
  }
  .group.split .cell {
    flex: 0 1 auto;
    align-items: center;
    gap: 0;
  }
  .main {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--pad-1);
    min-width: 0;
  }
  .cell.go,
  .part.go {
    cursor: pointer;
  }
  .cell.go:hover,
  .cell.go:focus-visible,
  .part.go:hover,
  .part.go:focus-visible {
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

  .parts {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0;
    min-width: 0;
    padding-left: var(--part-gap);
  }
  .group.split > .parts {
    padding-left: calc(var(--part-gap) - var(--pad-2));
  }
  .part {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    min-width: 0;
    padding: 0 var(--pad-1);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  .pn {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .pl {
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
      flex-wrap: wrap;
    }
    .group {
      flex: 1 1 6rem;
    }
  }
</style>
