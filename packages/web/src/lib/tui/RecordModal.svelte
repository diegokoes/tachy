<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import Modal from "./Modal.svelte";
  import Field from "./Field.svelte";
  import GroupHead from "./GroupHead.svelte";
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
    /** The dialog's accessible name only; the chrome draws no heading. */
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

  function readOnly(c: Column<T>): boolean {
    if (c.derive) return true;
    return mode === "edit" && c.editable !== undefined && row !== undefined
      ? !c.editable(row)
      : false;
  }

  /* A derived value is not the user's to set, so on the way in there is nothing
     to show them — the slug they cannot influence was only ever noise on an
     add form. In edit mode it stays, because that is where it carries the
     rename action. */
  const fields = $derived(
    columns.filter(
      (c) =>
        c.edit &&
        c.edit !== "none" &&
        (!c.only || c.only === mode) &&
        (!c.visible || c.visible(draft)) &&
        !(mode === "create" && readOnly(c)),
    ),
  );

  /* Runs of fields under their group label, in first-seen order. One group
     means the list named none, and the label is dropped. */
  const groups = $derived.by(() => {
    const out: { label: string; cols: Column<T>[] }[] = [];
    for (const c of fields) {
      const label = c.group ?? "";
      const last = out[out.length - 1];
      if (last && last.label === label) last.cols.push(c);
      else out.push({ label, cols: [c] });
    }
    return out;
  });
  const grouped = $derived(groups.length > 1);

  $effect(() => {
    if (mode !== "create") return;
    for (const c of columns) {
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

  const shown = (v: unknown) =>
    v === null || v === undefined || v === "" ? "—" : String(v);

  const optionsOf = (c: Column<T>) =>
    typeof c.options === "function" ? c.options(draft) : (c.options ?? []);
  const infoOf = (c: Column<T>) =>
    typeof c.info === "function" ? c.info(draft) : c.info;
  const placeholderOf = (c: Column<T>) =>
    typeof c.placeholder === "function" ? c.placeholder(draft) : c.placeholder;
  const wide = (c: Column<T>) =>
    c.span ? c.span === "full" : c.edit === "textarea" || c.edit === "secret";
</script>

<Modal
  {title}
  {width}
  {busy}
  {confirmLabel}
  confirmIcon="save"
  {onConfirm}
  {onCancel}
>
  {#if error}
    <Note tone="danger">{error}</Note>
  {/if}

  <div class="form">
    {#each groups as g, gi (gi)}
      {#if grouped && g.label}
        <div class="ghead"><GroupHead label={g.label} /></div>
      {/if}

      {#each g.cols as c (c.key)}
        <Field
          label={c.label}
          info={infoOf(c)}
          required={c.required}
          plain={readOnly(c)}
          wide={wide(c)}
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
                  // A rename rewrites the value this form is holding a copy
                  // of, so the form goes with it rather than saving the old
                  // one back over the new one.
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
              placeholder={placeholderOf(c)}
              value={String(draft[c.key] ?? "")}
              oninput={(e) => (draft[c.key] = e.currentTarget.value)}
            />
          {:else if c.edit === "textarea"}
            <textarea
              rows="3"
              aria-label={c.label}
              placeholder={placeholderOf(c)}
              value={String(draft[c.key] ?? "")}
              oninput={(e) => (draft[c.key] = e.currentTarget.value)}
            ></textarea>
          {:else}
            <input
              class:mono={Boolean(c.transform)}
              type="text"
              aria-label={c.label}
              placeholder={placeholderOf(c)}
              value={String(draft[c.key] ?? "")}
              oninput={(e) =>
                (draft[c.key] = c.transform
                  ? c.transform(e.currentTarget.value)
                  : e.currentTarget.value)}
            />
          {/if}
        </Field>
      {/each}
    {/each}

    {#if extra}<div class="ghead">{@render extra()}</div>{/if}
  </div>
</Modal>

<style>
  /* Two tracks where there is room and one where there is not, so a short
     field stops eating a whole row and a select sizes to its cell instead of
     to the dialog. The minimum is a real one: below it a label and its control
     stop fitting side by side at font scale 175%. */
  .form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: var(--pad-3) var(--pad-4);
    align-items: start;
  }
  .ghead {
    grid-column: 1 / -1;
  }
  .ghead:not(:first-child) {
    margin-top: var(--pad-2);
  }

  /* Fills its track, which is now half a dialog rather than all of one. Left
     to size itself a select would also change width with its own value. */
  .form :global(.asel) {
    width: 100%;
  }

  /* A key being pasted in, or a value normalised as it is typed — both are
     read character by character rather than as words. */
  .mono {
    font-family: var(--font-mono);
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
