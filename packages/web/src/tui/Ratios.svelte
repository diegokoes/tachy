<script lang="ts">
  import type { Ratio } from "./marks";
  import { toneVar } from "./scale";

  let { items }: { items: Ratio[] } = $props();
</script>

{#snippet name(ratio: Ratio)}
  {#if ratio.onclick}
    <button class="lbl pick" onclick={ratio.onclick}>{ratio.label}</button>
  {:else}
    <span class="lbl">{ratio.label}</span>
  {/if}
{/snippet}

<!--
@component
A share needs a bar and two numbers, not a ring: the row is as tall as a line of
text, so several fit in the room of one dial.
-->
<div class="ratios">
  {#each items as ratio (ratio.key)}
    <div
      class="row"
      style="--tone-color: {toneVar(ratio.tone)}; --rest-color: {toneVar(
        ratio.rest ?? ratio.tone,
      )}"
      class:split={Boolean(ratio.rest)}
    >
      {@render name(ratio)}
      <span
        class="track"
        role="meter"
        aria-label={ratio.title ?? ratio.label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(ratio.value * 100)}
      >
        <span
          class="fill"
          style="width: {Math.max(0, Math.min(1, ratio.value)) * 100}%"
        ></span>
      </span>
      <span class="n">{ratio.center}</span>
      {#if ratio.sub}<span class="sub">{ratio.sub}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .ratios {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    width: 100%;
    min-width: 0;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(3rem, 30%) minmax(0, 1fr) 2.5rem auto;
    align-items: center;
    gap: var(--pad-2);
    height: 1.25rem;
    font-size: var(--fs-xs);
  }
  .lbl {
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pick {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pick:hover,
  .pick:focus-visible {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .track {
    position: relative;
    height: 0.5rem;
    border-radius: 2px;
    background: color-mix(in srgb, var(--tone-color) 28%, transparent);
  }
  .split .track {
    background: var(--rest-color);
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 2px;
    background: var(--tone-color);
  }
  .n {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    text-align: right;
  }
  .sub {
    min-width: 2.5rem;
    font-family: var(--font-mono);
    color: var(--muted);
    white-space: nowrap;
  }
</style>
