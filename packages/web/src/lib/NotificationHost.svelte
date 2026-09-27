<script lang="ts">
  import { Modal, Button } from "./tui";
  import { portal } from "./tui/portal";
  import { confetti } from "./motion";
  import {
    notifyState,
    unread,
    dismissToast,
    markNotificationsRead,
  } from "./notify.svelte";

  // One celebration at a time: the oldest unread reply. Acknowledging it lets
  // the next surface.
  const celebration = $derived(
    unread().find((n) => n.kind === "report_reply") ?? null,
  );

  let burstEl = $state<HTMLElement>();
  let lastFired = "";

  // Fire the confetti once per celebration, as soon as its container is up.
  $effect(() => {
    if (celebration && burstEl && celebration.id !== lastFired) {
      lastFired = celebration.id;
      requestAnimationFrame(() => burstEl && confetti(burstEl, 44));
    }
  });

  function acknowledge() {
    if (celebration) void markNotificationsRead([celebration.id]);
  }
</script>

{#if celebration}
  <Modal
    title={celebration.title ?? "an admin replied"}
    onConfirm={acknowledge}
    onCancel={acknowledge}
    confirmLabel="thank you"
    confirmIcon="success"
    cancelLabel="close"
    width="30rem"
  >
    <div class="celebrate" bind:this={burstEl}>
      {#if celebration.body_text}
        <p class="reply">{celebration.body_text}</p>
      {/if}
      <Button variant="primary" full icon="success" onclick={acknowledge}>
        thank you for reporting it
      </Button>
    </div>
  </Modal>
{/if}

{#if notifyState.toasts.length}
  <div class="toasts" use:portal aria-live="polite">
    {#each notifyState.toasts as t (t.id)}
      <button
        class="toast {t.tone}"
        onclick={() => dismissToast(t.id)}
        title="dismiss"
      >
        {t.text}
      </button>
    {/each}
  </div>
{/if}

<style>
  .celebrate {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-height: 8rem;
    overflow: visible;
  }
  .reply {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
  }

  .toasts {
    position: fixed;
    right: var(--pad-4);
    bottom: var(--pad-4);
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    max-width: min(24rem, calc(100vw - 2 * var(--pad-4)));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    text-align: left;
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
    color: var(--text);
    background: var(--dialog-bg);
    border: var(--panel-line);
    border-left: 3px solid var(--muted);
    border-radius: var(--radius-control);
    padding: var(--pad-2) var(--pad-3);
    box-shadow: 0 8px 30px var(--drop);
  }
  .toast.ok {
    border-left-color: var(--ok);
  }
  .toast.accent {
    border-left-color: var(--accent);
  }
  .toast.danger {
    border-left-color: var(--danger);
  }
</style>
