<script lang="ts">
  import type { ComposerForm } from "@tachy/contract";
  import { api } from "../api";
  import { Icon, Note, Select } from "../tui";
  import FieldInput from "../work-items/FieldInput.svelte";
  import { editable, labelOf, TITLE } from "../work-items/layout";

  let {
    project,
    type,
    value,
    onchange,
  }: {
    /** A registered project's id. */
    project: string;
    type: string;
    value: Record<string, unknown>;
    onchange: (next: Record<string, unknown>) => void;
  } = $props();

  let form = $state<ComposerForm | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const p = project;
    const t = type;
    form = null;
    error = null;
    if (!p || !t) return;
    api
      .get<ComposerForm>(
        `/compose/projects/${p}/form?type=${encodeURIComponent(t)}`,
      )
      .then((f) => {
        if (p === project && t === type) form = f;
      })
      .catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });

  const specs = $derived(
    (form?.fields ?? []).filter(
      (f) => editable(f) && f.reference_name !== TITLE,
    ),
  );
  const chosen = $derived(specs.filter((f) => f.reference_name in value));
  const addable = $derived([
    { value: "", label: "add a field…" },
    ...specs
      .filter((f) => !(f.reference_name in value))
      .map((f) => ({
        value: f.reference_name,
        label: form ? labelOf(form, f) : f.name,
        hint: f.required ? "required" : undefined,
      })),
  ]);

  function set(ref: string, v: unknown) {
    onchange({ ...value, [ref]: v });
  }
  function drop(ref: string) {
    const next = { ...value };
    delete next[ref];
    onchange(next);
  }
</script>

{#if !project || !type}
  <Note>pick the project and type first</Note>
{:else if error}
  <Note tone="danger">{error}</Note>
{:else if !form}
  <Note>reading the {type} form…</Note>
{:else}
  <div class="fields">
    {#each chosen as f (f.reference_name)}
      <div class="row">
        <span class="name">{labelOf(form, f)}</span>
        <span class="input">
          <FieldInput
            id={`flow-${f.reference_name}`}
            spec={f}
            label={labelOf(form, f)}
            value={value[f.reference_name] ?? null}
            {form}
            onchange={(v) => set(f.reference_name, v)}
          />
        </span>
        <button
          class="drop"
          aria-label={`Leave ${labelOf(form, f)} to the form`}
          onclick={() => drop(f.reference_name)}
          ><Icon name="close" size="0.85em" /></button
        >
      </div>
    {/each}
    <Select
      value=""
      options={addable}
      searchable
      aria-label="Add a field"
      onchange={(v) => v && set(String(v), "")}
    />
  </div>
{/if}

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .row {
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--pad-2);
  }
  .name {
    font-size: var(--fs-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .input > :global(*) {
    width: 100%;
  }
  .drop {
    display: inline-flex;
    padding: 3px;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .drop:hover {
    color: var(--danger);
  }
</style>
