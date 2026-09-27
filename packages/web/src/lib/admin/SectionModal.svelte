<script lang="ts">
  import type { Component } from "svelte";
  import { Button, Modal } from "../tui";
  import { sectionAction } from "./sectionAction.svelte";

  let {
    section,
    label,
    view: View,
    onclose,
  }: {
    /** The section key, which is what its panel hoists its add action under. */
    section: string;
    label: string;
    view: Component;
    onclose: () => void;
  } = $props();

  const add = $derived(sectionAction(section));
</script>

<!-- A short list opens over the overview rather than replacing it: the counters
     behind it are the context for what you came to change, and losing them to
     read six rows is a bad trade. No confirm: this is a workspace, and every
     row in it saves itself. -->
<Modal title={label} width="62rem" cancelLabel="close" onCancel={onclose}>
  {#snippet barExtra()}
    {#if add}
      <Button
        variant="ghost"
        tone="ok"
        square
        icon="plus"
        title={add.label}
        aria-label={add.label}
        onclick={add.run}
      />
    {/if}
  {/snippet}

  <div class="admin-tables"><View /></div>
</Modal>
