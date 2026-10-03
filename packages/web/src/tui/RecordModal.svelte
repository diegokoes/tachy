<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import Modal from "./Modal.svelte";
  import Note from "./Note.svelte";
  import RecordForm from "./RecordForm.svelte";
  import type { Column, Draft } from "./table";
  import type { IconName } from "./icons";

  let {
    title,
    columns,
    draft,
    mode,
    row,
    busy = false,
    error = null,
    confirmLabel = "save",
    width = "40rem",
    destructive,
    onConfirm,
    onCancel,
    barExtra,
    extra,
  }: {
    /** Names the dialog, drawn in its titlebar. */
    title: string;
    columns: Column<T>[];
    /** Owned by the caller and mutated in place, so a commit reads it back. */
    draft: Draft;
    mode: "create" | "edit";
    row?: T;
    busy?: boolean;
    error?: string | null;
    confirmLabel?: string;
    width?: string;
    /** Deleting this record. Drawn at the far left of the titlebar. */
    destructive?: {
      label: string;
      icon?: IconName;
      onclick: () => void;
      busy?: boolean;
      disabled?: boolean;
    };
    onConfirm: () => void;
    onCancel: () => void;
    /** Per-record actions that are not save — test, reindex. Titlebar right. */
    barExtra?: Snippet;
    extra?: Snippet;
  } = $props();
</script>

<Modal
  {title}
  {width}
  {busy}
  {confirmLabel}
  confirmIcon={mode === "create" ? "create" : "save"}
  {destructive}
  {barExtra}
  {onConfirm}
  {onCancel}
>
  {#if error}
    <Note tone="danger">{error}</Note>
  {/if}

  <RecordForm {columns} {draft} {mode} {row} onleave={onCancel} {extra} />
</Modal>
