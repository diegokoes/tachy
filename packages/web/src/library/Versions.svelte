<script lang="ts">
  import { Modal, Time } from "../tui";
  import History from "./History.svelte";

  /**
   * "updated <date>" for one library item, as the way into its versions: the
   * date says when it last changed, and pressing it says what changed.
   */
  let {
    base,
    id,
    at,
    version,
    canEdit = false,
    onReverted,
  }: {
    base: "knowledge" | "reference";
    id: string;
    /** When the item last changed; nothing is drawn without it. */
    at?: string | null;
    version?: number;
    canEdit?: boolean;
    onReverted?: () => void;
  } = $props();

  let open = $state(false);
</script>

{#if at}
  <button
    class="updated"
    aria-haspopup="dialog"
    title="versions"
    onclick={() => (open = true)}>updated <Time {at} date /></button
  >
{/if}

{#if open}
  <Modal
    title="versions"
    cancelLabel="close"
    width="46rem"
    onCancel={() => (open = false)}
  >
    <History {base} {id} {version} {canEdit} {onReverted} />
  </Modal>
{/if}

<style>
  .updated {
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: var(--muted);
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .updated:hover {
    color: var(--text);
  }
  .updated:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }
</style>
