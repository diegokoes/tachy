<script lang="ts">
  import type { Entry } from "../chatState.svelte";
  import { Modal } from "../tui";

  type Approval = Extract<Entry, { kind: "approval" }>;

  let {
    entry,
    onclose,
    ondecide,
  }: {
    entry: Approval;
    onclose: () => void;
    ondecide: (approve: boolean) => void;
  } = $props();

  const pending = $derived(entry.status === "pending");
</script>

<Modal
  title={entry.tool}
  width="52rem"
  confirmLabel="approve"
  confirmIcon="check"
  cancelLabel={pending ? "deny" : "close"}
  onConfirm={pending
    ? () => {
        ondecide(true);
        onclose();
      }
    : undefined}
  onCancel={() => {
    if (pending) ondecide(false);
    onclose();
  }}
>
  <p class="lede">
    {pending ? "Review and edit the payload before approving." : entry.status}
  </p>
  <textarea
    class="editor"
    bind:value={entry.editable}
    disabled={!pending}
    spellcheck="false"
  ></textarea>
</Modal>

<style>
  .lede {
    margin: 0 0 var(--pad-2);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .editor {
    width: 100%;
    min-height: 18rem;
    max-height: 55vh;
    resize: vertical;
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
</style>
