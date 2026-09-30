<script lang="ts">
  import { keep, recall } from "../kept";
  import { Note, Select } from "../tui";
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

<div class="flows">
  {#if mode === "project"}
    <ProjectFlow {lead} />
  {:else}
    <header class="bar">{@render lead()}</header>
    <div class="empty">
      <Note>Complex flows are on their way.</Note>
    </div>
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
  .bar {
    display: flex;
    align-items: center;
    padding: var(--pad-3) 0;
    border-bottom: 1px solid var(--border);
  }
  .empty {
    padding-top: var(--pad-4);
  }
</style>
