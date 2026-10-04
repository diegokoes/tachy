<script lang="ts">
  import { keep, recall } from "../shell/kept";
  import ComplexFlow from "./ComplexFlow.svelte";
  import ProjectFlow from "./ProjectFlow.svelte";

  type Mode = "project" | "complex";

  let mode = $state<Mode>(recall("admin.flows.mode", "project"));
  $effect(() => keep("admin.flows.mode", mode));

  const complex = $derived(mode === "complex");
</script>

<!-- Either/or rather than on/off, so the switch stays accent on both sides
     instead of going green the way a checkbox does when it is on. -->
{#snippet lead()}
  <button
    class="switch"
    role="switch"
    aria-checked={complex}
    aria-label="Flow mode: complex"
    onclick={() => (mode = complex ? "project" : "complex")}
  >
    <span class="side" class:on={!complex}>project</span>
    <span class="track" class:right={complex} aria-hidden="true"
      ><span class="knob"></span></span
    >
    <span class="side" class:on={complex}>complex</span>
  </button>
{/snippet}

<div class="flows" class:canvas={complex}>
  {#if complex}
    <ComplexFlow {lead} />
  {:else}
    <ProjectFlow {lead} />
  {/if}
</div>

<style>
  .flows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--view-pad-x) var(--view-pad-y);
  }
  .switch {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    min-height: var(--control-h);
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    cursor: pointer;
  }
  .switch:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 2px;
  }
  .side {
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
    transition: color 0.2s ease;
  }
  .side.on {
    color: var(--accent);
  }
  .switch:hover .side:not(.on) {
    color: var(--text);
  }
  .track {
    box-sizing: border-box;
    display: block;
    width: 2.1em;
    height: 1.1em;
    padding: 0.18em;
    border-radius: var(--radius-chip);
    background: color-mix(in srgb, var(--accent) 12%, var(--panel-solid));
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .knob {
    display: block;
    width: 50%;
    height: 100%;
    border-radius: var(--radius-chip);
    background: var(--accent-fill);
    transition: transform 0.2s ease;
  }
  .track.right .knob {
    transform: translateX(100%);
  }
  @media (prefers-reduced-motion: reduce) {
    .knob {
      transition: none;
    }
  }
  /* The canvas scrolls itself, so the panel holds still around it. */
  .flows.canvas {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
