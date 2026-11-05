<script lang="ts" module>
  /** What the dialog edits; `product` and the two edges are slugs, "" for none. */
  export interface UnitDraft {
    product: string;
    kind: string;
    name: string;
    slug: string;
    parent: string;
    template: string;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { CustomerUnitRow, ProductBlueprint } from "@tachy/contract";
  import { INFO } from "../admin/help";
  import { slugify, uniqueSlug } from "../slug";
  import { Field, Modal, Note, Select } from "../tui";
  import { parentChoices, templateChoices, unitKindChoices } from "./customer";

  let {
    units,
    blueprints,
    products,
    initial,
    editing = null,
    busy,
    error,
    onsave,
    ondelete,
    oncancel,
  }: {
    units: CustomerUnitRow[];
    blueprints: Record<string, ProductBlueprint>;
    /** The products the caller may add to; "" is general. */
    products: { value: string; label: string }[];
    initial: UnitDraft;
    /** The unit being edited; null when adding one. */
    editing?: CustomerUnitRow | null;
    busy: boolean;
    error: string | null;
    onsave: (draft: UnitDraft) => void;
    ondelete?: () => void;
    oncancel: () => void;
  } = $props();

  // The dialog is opened once per draft; later prop changes do not reset it.
  // svelte-ignore state_referenced_locally
  let draft = $state({ ...initial });
  let slugTouched = $state(false);
  let armed = $state(false);

  const blueprint = $derived(
    draft.product ? blueprints[draft.product] : undefined,
  );
  const kinds = $derived(
    unitKindChoices(
      blueprint,
      units
        .filter((u) => (u.product_slug ?? "") === draft.product)
        .map((u) => u.kind),
    ),
  );
  const placement = $derived({
    units,
    blueprint,
    product: draft.product || null,
    kind: draft.kind,
    editing,
  });
  const unitOptions = (choices: CustomerUnitRow[]) => [
    { value: "", label: "none" },
    ...choices.map((u) => ({ value: u.slug, label: u.name })),
  ];
  const parents = $derived(unitOptions(parentChoices(placement)));
  const templates = $derived(unitOptions(templateChoices(placement)));

  // A parent or template the new kind may not take is let go, not kept hidden.
  $effect(() => {
    if (!parents.some((o) => o.value === draft.parent)) draft.parent = "";
    if (!templates.some((o) => o.value === draft.template)) draft.template = "";
  });

  // Follows the name only: the page reloads its units after a save while the
  // dialog is still open, and the new unit must not push its own id aside.
  $effect(() => {
    if (editing || slugTouched) return;
    const base = slugify(draft.name);
    draft.slug = untrack(() =>
      uniqueSlug(
        base,
        units.map((u) => u.slug),
      ),
    );
  });

  const ready = $derived(
    !!draft.name.trim() && !!draft.kind.trim() && !!draft.slug.trim(),
  );

  function remove() {
    if (!armed) {
      armed = true;
      return;
    }
    armed = false;
    ondelete?.();
  }
</script>

<Modal
  title={editing ? `unit: ${editing.name}` : "add a unit"}
  confirmLabel={editing ? "save" : "add unit"}
  confirmIcon={editing ? "save" : "plus"}
  width="40rem"
  {busy}
  disabled={!ready}
  destructive={editing && ondelete
    ? {
        label: armed ? "confirm delete" : "delete unit",
        icon: armed ? "confirm" : "delete",
        busy,
        onclick: remove,
      }
    : undefined}
  onConfirm={() => onsave($state.snapshot(draft))}
  onCancel={oncancel}
>
  <div class="form">
    <Field label="product">
      {#if editing || products.length < 2}
        <span class="ro"
          >{products.find((p) => p.value === draft.product)?.label ??
            "general"}</span
        >
      {:else}
        <Select
          bind:value={draft.product}
          options={products}
          aria-label="product"
        />
      {/if}
    </Field>
    <Field label="kind">
      <Select
        bind:value={draft.kind}
        options={kinds.kinds}
        creatable={kinds.free}
        aria-label="kind"
      />
    </Field>
    <Field label="name">
      <input aria-label="name" bind:value={draft.name} />
    </Field>
    <Field label="id" info={INFO.slug}>
      {#if editing}
        <span class="ro mono">{draft.slug}</span>
      {:else}
        <input
          class="mono"
          aria-label="id"
          bind:value={draft.slug}
          oninput={() => (slugTouched = true)}
        />
      {/if}
    </Field>
    {#if parents.length > 1}
      <Field label="inside">
        <Select
          bind:value={draft.parent}
          options={parents}
          aria-label="inside"
        />
      </Field>
    {/if}
    {#if templates.length > 1}
      <Field label="template">
        <Select
          bind:value={draft.template}
          options={templates}
          aria-label="template"
        />
      </Field>
    {/if}
  </div>
  {#if error}<Note tone="danger">{error}</Note>{/if}
</Modal>

<style>
  /* RecordForm's tracks: two where there is room, one where there is not. */
  .form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: var(--pad-3) var(--pad-4);
    align-items: start;
  }
  .form :global(.asel) {
    width: 100%;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .ro {
    display: block;
    padding: var(--pad-2) 0;
    color: var(--muted);
  }
</style>
