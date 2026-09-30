<script lang="ts">
  import { keep, recall } from "../kept";
  import { Select } from "../tui";
  import ComplexFlow from "./ComplexFlow.svelte";
  import ProjectFlow from "./ProjectFlow.svelte";

  type Mode = "project" | "complex";
  const MODES = [
    { value: "project", label: "project flow" },
    { value: "complex", label: "complex flow" },
  ];

  let mode = $state<Mode>(recall("admin.flows.mode", "project"));
  $effect(() => keep("admin.flows.mode", mode));
</script>

{#snippet lead()}
  <span class="mode">
    <span class="k">flow mode</span>
    <span class="pick">
      <Select
        value={mode}
        options={MODES}
        aria-label="Flow mode"
        onchange={(v) => (mode = v as Mode)}
      />
    </span>
  </span>
{/snippet}

<div class="flows" class:canvas={mode === "complex"}>
  {#if mode === "project"}
    <ProjectFlow {lead} />
  {:else}
    <ComplexFlow {lead} />
  {/if}
</div>

<style>
  .flows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--view-pad-x) var(--view-pad-y);
  }
  .mode {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-3);
  }
  .k {
    font-size: var(--fs-xs);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
  }
  .pick {
    width: 12rem;
  }
  .pick > :global(*) {
    width: 100%;
  }
  /* The canvas scrolls itself, so the panel holds still around it. */
  .flows.canvas {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
