<script lang="ts">
  // The shared slug-rename flow: fetch the cascade impact for `resource`, show it
  // in the retro AsciiModal, and POST the rename on confirm. Panels supply only
  // the resource path, the target slug, a message snippet (fed the impact counts),
  // and an onRenamed hook for any follow-up field patch + reload.
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
    resource: string; // base path including the current slug, e.g. "/products/tpd/labels/lc"
    to: string;
    onRenamed: () => void | Promise<void>; // follow-up patch + reload + close
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
      busy = false; // leave the modal open so the user can retry or cancel
    }
  }
</script>

{#if impact}
  <AsciiModal {title} confirmLabel="rename" danger {busy} onConfirm={confirm} onCancel={onCancel}>
    {@render message(impact)}
  </AsciiModal>
{/if}
