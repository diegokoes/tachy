<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import Modal from "./Modal.svelte";
  import Field from "./Field.svelte";
  import Note from "./Note.svelte";
  import Button from "./Button.svelte";
  import Checkbox from "./Checkbox.svelte";
  import Select from "../AsciiSelect.svelte";
  import type { Column, Draft } from "./table";

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
    onConfirm,
    onCancel,
    extra,
  }: {
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
    onConfirm: () => void;
    onCancel: () => void;
    extra?: Snippet;
  } = $props();

  const fields = $derived(
    columns.filter(
      (c) =>
        c.edit &&
        c.edit !== "none" &&
        (!c.only || c.only === mode) &&
        (!c.visible || c.visible(draft)),
    ),
  );

  /* A derived field is only ever computed while creating: once a slug exists,
     knowledge entries and docs carry it in their tags, so moving it is a
     rename with its own impact check — not a side effect of an edit. */
  $effect(() => {
    if (mode !== "create") return;
    for (const c of fields) {
      if (!c.derive) continue;
      const next = c.derive(draft);
      if (draft[c.key] !== next) draft[c.key] = next;
    }
  });

  /* A select whose options depend on another field is holding a stale value the
     moment that field changes — the control renders blank (nothing matches) while
     the draft still carries the old one, and the form submits what was never on
     screen. Clearing it makes the required-check catch it here instead of the
     server rejecting a value the user never chose. */
  $effect(() => {
    for (const c of fields) {
      if (c.edit !== "select" || readOnly(c)) continue;
      const current = draft[c.key];
      if (current === "" || current == null) continue;
      if (!optionsOf(c).some((o) => o.value === current)) draft[c.key] = "";
    }
  });

  function readOnly(c: Column<T>): boolean {
    if (c.derive) return true;
    return mode === "edit" && c.editable !== undefined && row !== undefined
      ? !c.editable(row)
      : false;
  }

  const shown = (v: unknown) =>
    v === null || v === undefined || v === "" ? "—" : String(v);

  const optionsOf = (c: Column<T>) =>
    typeof c.options === "function" ? c.options(draft) : (c.options ?? []);
  const hintOf = (c: Column<T>) =>
    typeof c.hint === "function" ? c.hint(draft) : c.hint;
  const infoOf = (c: Column<T>) =>
    typeof c.info === "function" ? c.info(draft) : c.info;
</script>

<Modal
  {title}
  {width}
  {busy}
  confirmLabel={confirmLabel}
  confirmIcon="save"
  {onConfirm}
  {onCancel}
>
  {#if error}
    <Note tone="danger">{error}</Note>
  {/if}

  <div class="form">
    {#each fields as c (c.key)}
      <Field
        label={c.label}
        hint={hintOf(c)}
        info={infoOf(c)}
        required={c.required}
        plain={readOnly(c)}
      >
        {#if readOnly(c)}
          <span class="ro">{shown(draft[c.key])}</span>
          {#if mode === "edit" && c.action && row !== undefined}
            {@const act = c.action}
            {@const target = row}
            <Button
              variant="ghost"
              size="sm"
              icon={act.icon ?? "edit"}
              onclick={() => {
                // Its own step, in its own dialog — two stacked modals would
                // both answer Enter and Escape. Open the next one before
                // dismissing this one, or the caller's state lands on a
                // component that is already on its way out.
                act.onclick(target);
                onCancel();
              }}>{act.label}</Button
            >
          {/if}
        {:else if c.edit === "select"}
          <Select
            value={(draft[c.key] ?? "") as string}
            options={optionsOf(c)}
            aria-label={c.label}
            onchange={(v) => (draft[c.key] = v)}
          />
        {:else if c.edit === "checkbox"}
          <Checkbox
            ariaLabel={c.label}
            checked={Boolean(draft[c.key])}
            onchange={(checked) => (draft[c.key] = checked)}
          />
        {:else if c.edit === "secret"}
          <input
            class="mono"
            type="password"
            autocomplete="off"
            aria-label={c.label}
            value={String(draft[c.key] ?? "")}
            oninput={(e) => (draft[c.key] = e.currentTarget.value)}
          />
        {:else if c.edit === "textarea"}
          <textarea
            rows="3"
            aria-label={c.label}
            value={String(draft[c.key] ?? "")}
            oninput={(e) => (draft[c.key] = e.currentTarget.value)}
          ></textarea>
        {:else}
          <input
            class:mono={Boolean(c.transform)}
            type="text"
            aria-label={c.label}
            value={String(draft[c.key] ?? "")}
            oninput={(e) =>
              (draft[c.key] = c.transform
                ? c.transform(e.currentTarget.value)
                : e.currentTarget.value)}
          />
        {/if}
      </Field>
    {/each}

    {#if extra}{@render extra()}{/if}
  </div>
</Modal>

<style>
  /* One field per row: a select needs the width to show its options, which is
     exactly what it never had inside a table column. */
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    min-width: 24rem;
  }

  /* A key being pasted in, or a value normalised as it is typed — both are
     read character by character rather than as words. */
  .mono {
    font-family: var(--font-mono);
  }

  /* Selects are inline-flex by default and would otherwise shrink to their
     current label. */
  .form :global(.asel) {
    width: 100%;
  }

  /* Read-only fields are slugs and derived names — identifiers, not prose. */
  .ro {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
