<script lang="ts">
  import { Modal } from "../tui";
  import { portal } from "../tui/portal";
  import { confetti } from "../motion/motion";
  import {
    notifyState,
    unreadReplies,
    dismissToast,
    markNotificationsRead,
  } from "./notify.svelte";

  // Every unread reply in one dialog: acknowledging reads them all, so a
  // second reply never waits behind the first.
  const replies = $derived(unreadReplies());
  const title = $derived(
    replies.length === 1
      ? (replies[0].title ?? "an admin replied")
      : `${replies.length} replies to your reports`,
  );

  let burstEl = $state<HTMLElement>();
  let landed = $state(false);
  let celebrated = false;

  $effect(() => {
    if (replies.length) return;
    landed = false;
    celebrated = false;
  });

  // Once per dialog, after it has unfolded.
  $effect(() => {
    if (!replies.length || !burstEl || !landed || celebrated) return;
    celebrated = true;
    confetti(burstEl, 44);
  });

  function acknowledge() {
    void markNotificationsRead(replies.map((reply) => reply.id));
  }
</script>

{#if replies.length}
  <Modal
    {title}
    onConfirm={acknowledge}
    onCancel={acknowledge}
    confirmLabel="thank you"
    confirmIcon="success"
    cancelLabel="close"
    width="36rem"
    onOpened={() => (landed = true)}
  >
    <div class="celebrate" bind:this={burstEl}>
      {#each replies as reply (reply.id)}
        <section class="one">
          {#if replies.length > 1 && reply.title}
            <h3>{reply.title}</h3>
          {/if}
          {#if reply.body_text}<p class="reply">{reply.body_text}</p>{/if}
        </section>
      {/each}
    </div>
  </Modal>
{/if}

{#if notifyState.toasts.length}
  <div class="toasts" use:portal aria-live="polite">
    {#each notifyState.toasts as toast (toast.id)}
      <button class="toast {toast.tone}" onclick={() => dismissToast(toast.id)}>
        {toast.text}
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
  .one {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--muted);
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
    border-left: 3px solid var(--rule);
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
