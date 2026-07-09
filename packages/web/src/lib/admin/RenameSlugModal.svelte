<script lang="ts">
  
  
  
  
  import { onMount, type Snippet } from "svelte";
  import { api } from "../api";
  import AsciiModal from "../AsciiModal.svelte";
  import { errText } from "./shared";

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
  <AsciiModal {title} confirmLabel="rename" danger {busy} onConfirm={confirm} onCancel={onCancel}>
    {@render message(impact)}
  </AsciiModal>
{/if}
