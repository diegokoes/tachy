<script lang="ts">
  import { keep, recall } from "../shell/kept";
  import { Choice } from "../tui";
  import ComplexFlow from "./ComplexFlow.svelte";
  import ProjectFlow from "./ProjectFlow.svelte";

  type Mode = "project" | "complex";

  const MODES = [
    { value: "project", label: "projects" },
    { value: "complex", label: "automations" },
  ] as const;

  let mode = $state<Mode>(recall("admin.flows.mode", "project"));
  $effect(() => keep("admin.flows.mode", mode));

  const complex = $derived(mode === "complex");
</script>

{#snippet lead()}
  <Choice
    options={MODES}
    value={mode}
    label="flows"
    onpick={(picked) => (mode = picked)}
  />
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
  /* The canvas scrolls itself, so the panel holds still around it. */
  .flows.canvas {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
