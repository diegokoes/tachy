<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import Field from "./Field.svelte";
  import GroupHead from "./GroupHead.svelte";
  import Button from "./Button.svelte";
  import Checkbox from "./Checkbox.svelte";
  import Select from "./AsciiSelect.svelte";
  import type { Column, Draft } from "./table";

  /** The fields of one record, laid out from its columns. Drawn by RecordModal. */
  let {
    columns,
    draft,
    mode,
    row,
    onleave,
    extra,
  }: {
    columns: Column<T>[];
    /** Owned by the caller and mutated in place, so a commit reads it back. */
    draft: Draft;
    mode: "create" | "edit";
    row?: T;
    /** Called after a field's own action, e.g. a rename, has taken over. */
    onleave?: () => void;
    extra?: Snippet;
  } = $props();

  function readOnly(c: Column<T>): boolean {
    if (c.derive) return true;
    return mode === "edit" && c.editable !== undefined && row !== undefined
      ? !c.editable(row)
      : false;
  }

  // A derived value is not the user's to set, so an add form does not show it.
  // In edit mode it stays, because that is where it carries the rename action.
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

  // Runs of fields under their group label, in first-seen order. One group
  // means the list named none, and the label is dropped.
  const groups = $derived.by(() => {
    const grouped: { label: string; cols: Column<T>[] }[] = [];
    for (const column of fields) {
      const label = column.group ?? "";
      const last = grouped[grouped.length - 1];
      if (last && last.label === label) last.cols.push(column);
      else grouped.push({ label, cols: [column] });
    }
    return grouped;
  });
  const grouped = $derived(groups.length > 1);

  $effect(() => {
    if (mode !== "create") return;
    for (const column of columns) {
      if (!column.derive) continue;
      const next = column.derive(draft);
      if (draft[column.key] !== next) draft[column.key] = next;
    }
  });

  // A select whose options depend on another field holds a stale value once
  // that field changes: the control renders blank while the draft carries the
  // old one. Clearing it lets the required-check catch it here.
  $effect(() => {
    for (const column of fields) {
      if (column.edit !== "select" || readOnly(column)) continue;
      const current = draft[column.key];
      if (current === "" || current == null) continue;
      if (!optionsOf(column).some((o) => o.value === current))
        draft[column.key] = "";
    }
  });

  const shown = (v: unknown) =>
    v === null || v === undefined || v === "" ? "-" : String(v);

  const optionsOf = (c: Column<T>) =>
    typeof c.options === "function" ? c.options(draft) : (c.options ?? []);
  const infoOf = (c: Column<T>) =>
    typeof c.info === "function" ? c.info(draft) : c.info;
  const placeholderOf = (c: Column<T>) =>
    typeof c.placeholder === "function" ? c.placeholder(draft) : c.placeholder;
  const wide = (c: Column<T>) =>
    c.span ? c.span === "full" : c.edit === "textarea" || c.edit === "secret";
</script>

<div class="form">
  {#each groups as group, groupIndex (groupIndex)}
    {#if grouped && group.label}
      <div class="ghead"><GroupHead label={group.label} /></div>
    {/if}

    {#each group.cols as column (column.key)}
      <Field
        label={column.label}
        info={infoOf(column)}
        required={column.required}
        plain={readOnly(column) || Boolean(column.aside)}
        wide={wide(column)}
      >
        {#if readOnly(column)}
          <span class="ro">{shown(draft[column.key])}</span>
          {#if mode === "edit" && column.action && row !== undefined}
            {@const act = column.action}
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
                onleave?.();
              }}>{act.label}</Button
            >
          {/if}
        {:else if column.edit === "select"}
          <Select
            value={(draft[column.key] ?? "") as string}
            options={optionsOf(column)}
            searchable={column.searchable}
            aria-label={column.label}
            onchange={(v) => (draft[column.key] = v)}
          />
        {:else if column.edit === "checkbox"}
          <Checkbox
            ariaLabel={column.label}
            checked={Boolean(draft[column.key])}
            onchange={(checked) => (draft[column.key] = checked)}
          />
        {:else if column.edit === "secret"}
          <input
            class="mono secret"
            type="password"
            autocomplete="off"
            aria-label={column.label}
            placeholder={placeholderOf(column)}
            value={String(draft[column.key] ?? "")}
            oninput={(e) => (draft[column.key] = e.currentTarget.value)}
          />
        {:else if column.edit === "textarea"}
          <textarea
            rows="3"
            aria-label={column.label}
            placeholder={placeholderOf(column)}
            value={String(draft[column.key] ?? "")}
            oninput={(e) => (draft[column.key] = e.currentTarget.value)}
          ></textarea>
        {:else}
          <input
            class:mono={Boolean(column.transform)}
            type="text"
            aria-label={column.label}
            placeholder={placeholderOf(column)}
            value={String(draft[column.key] ?? "")}
            oninput={(e) =>
              (draft[column.key] = column.transform
                ? column.transform(e.currentTarget.value)
                : e.currentTarget.value)}
          />
        {/if}
        {#if column.aside}{@render column.aside({ draft, mode })}{/if}
      </Field>
    {/each}
  {/each}

  {#if extra}<div class="ghead">{@render extra()}</div>{/if}
</div>

<style>
  /* Two tracks where there is room and one where there is not, so a short
     field does not take a whole row. Under the minimum a label and its
     control stop fitting side by side at the largest font scale. */
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

  /* Fills its track, which is half a dialog rather than all of one. Left
     to size itself a select would also change width with its own value. */
  .form :global(.asel) {
    width: 100%;
  }

  /* A key being pasted in, or a value normalised as it is typed - both are
     read character by character rather than as words. */
  .mono {
    font-family: var(--font-mono);
  }

  /* A stored secret is never sent back, so its placeholder stands in for it
     and reads as the dots the input would show. */
  .secret::placeholder {
    color: var(--text);
    letter-spacing: 0.2em;
  }

  /* Read-only fields are slugs and derived names - identifiers, not prose. */
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
