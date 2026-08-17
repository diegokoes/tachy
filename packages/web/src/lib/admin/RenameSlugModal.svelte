<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { Modal } from "../tui";

  export type RenameImpact = { entries: number; docs?: number };

  let {
    title = "rename slug",
    resource,
    to,
    onRenamed,
    onCancel,
    onError,
    message,
  }: {
    title?: string;
    /** Resource path INCLUDING the current slug, e.g. /products/x/labels/y */
    resource: string;
    to: string;
    onRenamed: () => void | Promise<void>;
    onCancel: () => void;
    onError: (msg: string) => void;
    message: Snippet<[RenameImpact]>;
  } = $props();

  let impact = $state<RenameImpact | null>(null);
  let busy = $state(false);

  onMount(async () => {
    try {
      impact = await api.get<RenameImpact>(`${resource}/rename-impact`);
    } catch (e) {
      onError(errText(e));
      onCancel();
    }
  });

  async function confirm() {
    busy = true;
    try {
      await api.post(`${resource}/rename`, { to });
      await onRenamed();
    } catch (e) {
      onError(errText(e));
      busy = false;
    }
  }
</script>

{#if impact}
  <Modal
    {title}
    confirmLabel="rename"
    confirmIcon="edit"
    danger
    {busy}
    onConfirm={confirm}
    {onCancel}
  >
    {@render message(impact)}
  </Modal>
{/if}
