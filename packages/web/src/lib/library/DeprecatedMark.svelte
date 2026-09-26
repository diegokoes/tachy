<script lang="ts">
  import { shadowPulse } from "../motion";
  import { Button, Icon, Modal } from "../tui";

  /** A deprecated entry's status tag. The warning behind it opens on click. */
  let {
    onReplacement,
  }: {
    /** Present when the entry names the one that superseded it. */
    onReplacement?: () => void;
  } = $props();

  let open = $state(false);
</script>

<button
  class="tag"
  title="why this is outdated"
  aria-haspopup="dialog"
  use:shadowPulse
  onclick={() => (open = true)}>deprecated</button
>

{#if open}
  <Modal title="deprecated" cancelLabel="close" onCancel={() => (open = false)}>
    <div class="warning">
      <p>
        <Icon name="deprecate" size="1.1em" weight={7} />
        <span><strong>Outdated</strong>: not current advice.</span>
      </p>
      {#if onReplacement}
        <Button
          size="sm"
          tone="warn"
          onclick={() => {
            open = false;
            onReplacement();
          }}>view replacement</Button
        >
      {/if}
    </div>
  </Modal>
{/if}

<style>
  /* Badge's warn tone, as a button. */
  .tag {
    display: inline-flex;
    align-items: center;
    font: inherit;
    font-size: var(--fs-xs);
    line-height: 1.4;
    border: 1px solid var(--warn);
    border-radius: var(--radius-chip);
    padding: 0 var(--pad-2);
    white-space: nowrap;
    color: var(--warn);
    background: transparent;
    cursor: pointer;
  }
  .tag:hover {
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }
  .tag:focus-visible {
    outline: 1px solid var(--warn);
    outline-offset: 2px;
  }
  .warning {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--pad-3);
  }
  .warning p {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0;
    color: var(--warn);
  }
</style>
