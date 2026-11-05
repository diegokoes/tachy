<script lang="ts" module>
  /** A fact as the editor holds it; `doc` is a doc id, "" for none. */
  export interface FactDraft {
    kind: string;
    label: string;
    value: string;
    doc: string;
  }
</script>

<script lang="ts">
  import { tick } from "svelte";
  import type { CustomerFactRow, CustomerProfile } from "@tachy/contract";
  import { link } from "../shell/router.svelte";
  import Group from "../settings/Group.svelte";
  import { Button, DeleteButton, Field, Note, Select } from "../tui";

  type Fact = CustomerProfile["facts"][number];

  let {
    facts,
    missing,
    ownFact,
    canEdit,
    kindChoices,
    valueChoices,
    documents,
    originName,
    busy,
    error,
    onset,
    ondelete,
  }: {
    facts: Fact[];
    /** Fact kinds the blueprint asks for that nothing records. */
    missing: string[];
    /** The stored fact behind a shown one, when it is recorded right here. */
    ownFact: (kind: string, label: string) => CustomerFactRow | undefined;
    canEdit: boolean;
    kindChoices: { kinds: string[]; free: boolean };
    /** The values a fact kind may take; empty when it takes any. */
    valueChoices: (kind: string) => string[];
    /** The docs a fact here may link. */
    documents: { id: string; title: string }[];
    /** Where an inherited fact comes from, by its origin unit's slug. */
    originName: (origin: string | null) => string;
    busy: boolean;
    /** The refusal of the last save or removal, said under the editor it came from. */
    error: string | null;
    /** Resolves true once saved, which closes the editor. */
    onset: (fact: FactDraft) => Promise<boolean>;
    /** Resolves true once removed, which closes the editor. */
    ondelete: (factId: string) => Promise<boolean>;
  } = $props();

  const NEW_FACT = "new";
  /** The row the editor stands in for: a fact's key, a missing kind's, or NEW_FACT. */
  let open = $state<string | null>(null);
  let draft = $state<FactDraft>({ kind: "", label: "", value: "", doc: "" });
  let valueField = $state<HTMLInputElement | null>(null);
  let newForm = $state<HTMLFormElement | null>(null);
  /** The row whose last save or removal was refused, so the refusal stays with it. */
  let refusedRow = $state<string | null>(null);

  const rowKey = (fact: { kind: string; label: string }) =>
    `${fact.kind}\u0000${fact.label}`;
  const missingKey = (kind: string) => `missing\u0000${kind}`;
  const choices = $derived(draft.kind ? valueChoices(draft.kind) : []);
  const ready = $derived(!!draft.kind.trim() && !!draft.value.trim());
  /** The fact the editor is open on, when it is recorded right here and so can be removed. */
  const editingOwn = $derived(
    open && open !== NEW_FACT ? ownFact(draft.kind, draft.label) : undefined,
  );

  /** Opens the editor on a row, filled with what the row shows, focused where typing starts. */
  function edit(row: string, start: Partial<FactDraft>) {
    draft = { kind: "", label: "", value: "", doc: "", ...start };
    open = row;
    void tick().then(() => {
      if (row !== NEW_FACT) return valueField?.focus();
      newForm?.querySelector<HTMLElement>("button, input")?.focus();
    });
  }

  const editFact = (fact: Fact) =>
    edit(rowKey(fact), {
      kind: fact.kind,
      label: fact.label,
      value: fact.value,
      doc: fact.inherited ? "" : (fact.doc?.id ?? ""),
    });

  /** Closes the editor once `write` lands; a refusal keeps it open, said there. */
  async function settle(write: Promise<boolean>) {
    const row = open;
    const done = await write;
    refusedRow = done ? null : row;
    if (done) open = null;
  }

  const remove = (factId: string) => settle(ondelete(factId));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (ready) void settle(onset({ ...draft }));
  }

  function closeOnEscape(e: KeyboardEvent) {
    if (open === null || e.key !== "Escape") return;
    open = null;
  }
</script>

<svelte:window onkeydown={closeOnEscape} />

{#snippet valueControl()}
  {#if choices.length}
    <Select bind:value={draft.value} options={choices} aria-label="value" />
  {:else}
    <input
      class="value-field"
      aria-label="value"
      bind:value={draft.value}
      bind:this={valueField}
    />
  {/if}
{/snippet}

{#snippet docControl()}
  <Select
    bind:value={draft.doc}
    options={[
      { value: "", label: "none" },
      ...documents.map((doc) => ({ value: doc.id, label: doc.title })),
    ]}
    aria-label="doc"
  />
{/snippet}

{#snippet buttons()}
  <span class="buttons">
    <Button type="submit" size="sm" variant="primary" {busy} disabled={!ready}
      >save</Button
    >
    <Button size="sm" variant="ghost" onclick={() => (open = null)}
      >cancel</Button
    >
    {#if editingOwn}
      {@const recorded = editingOwn}
      <DeleteButton
        label="remove fact"
        text="remove"
        {busy}
        onclick={() => void remove(recorded.id)}
      />
    {/if}
  </span>
  {#if error && refusedRow === open}<div class="refused">
      <Note tone="danger">{error}</Note>
    </div>{/if}
{/snippet}

{#snippet inPlace()}
  <form class="in-place" onsubmit={submit}>
    <span class="kind">{draft.kind}</span>
    <span class="label">{draft.label}</span>
    <span class="value">{@render valueControl()}</span>
    <span class="meta"
      >{#if documents.length}{@render docControl()}{/if}</span
    >
    {@render buttons()}
  </form>
{/snippet}

<!-- A new fact names its kind and label too, so each field carries its caption. -->
{#snippet newFact()}
  <form class="new" onsubmit={submit} bind:this={newForm}>
    <Field label="fact">
      <Select
        bind:value={draft.kind}
        options={kindChoices.kinds}
        creatable={kindChoices.free}
        aria-label="fact"
      />
    </Field>
    <Field label="label">
      <input class="label-field" bind:value={draft.label} />
    </Field>
    <Field label="value">{@render valueControl()}</Field>
    {#if documents.length}
      <Field label="doc">{@render docControl()}</Field>
    {/if}
    {@render buttons()}
  </form>
{/snippet}

<Group label="facts">
  {#snippet action()}
    {#if canEdit}
      <Button
        variant="ghost"
        size="sm"
        square
        icon="plus"
        title="add a fact"
        onclick={() => edit(NEW_FACT, {})}
      />
    {/if}
  {/snippet}
  <div class="facts">
    {#each facts as fact (rowKey(fact))}
      {#if open === rowKey(fact)}
        {@render inPlace()}
      {:else}
        <div class="fact" class:inherited={fact.inherited}>
          <span class="kind">{fact.kind}</span>
          <span class="label">{fact.label}</span>
          <span class="value">
            {#if canEdit}
              <button class="pick" onclick={() => editFact(fact)}
                >{fact.value}</button
              >
            {:else}
              {fact.value}
            {/if}
          </span>
          <span class="meta">
            {#if fact.inherited}from {originName(fact.origin ?? null)}{/if}
            {#if fact.inherited && fact.doc}·{/if}
            {#if fact.doc}
              <a href="/library/docs/{fact.doc.id}" use:link>{fact.doc.title}</a
              >
            {/if}
          </span>
        </div>
      {/if}
    {/each}
    {#each missing as kind (kind)}
      {#if open === missingKey(kind)}
        {@render inPlace()}
      {:else}
        <div class="fact missing">
          <span class="kind">{kind}</span>
          <span class="label"></span>
          <span class="value">
            {#if canEdit}
              <button
                class="pick"
                onclick={() => edit(missingKey(kind), { kind })}
                >not recorded</button
              >
            {:else}
              not recorded
            {/if}
          </span>
          <span class="meta"></span>
        </div>
      {/if}
    {/each}
    {#if open === NEW_FACT}{@render newFact()}{/if}
  </div>
  {#if !facts.length && !missing.length && open !== NEW_FACT}
    <p class="none">none recorded</p>
  {/if}
</Group>

<style>
  /* One line a fact: what it is, its value, and where it comes from; the last
     track gives way first when the column narrows. */
  .facts {
    display: grid;
    grid-template-columns:
      max-content max-content minmax(8rem, 1fr)
      minmax(0, max-content);
    column-gap: var(--pad-3);
    row-gap: var(--pad-1);
    align-items: baseline;
  }
  .fact {
    display: contents;
  }
  .kind,
  .value {
    font-family: var(--font-mono);
  }
  .label,
  .meta,
  .none {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    margin: 0;
  }
  /* An inherited fact reads as context rather than as this unit's own record. */
  .fact.inherited .value,
  .fact.missing .kind,
  .fact.missing .value {
    opacity: 0.65;
  }
  /* The value itself is the way into editing it: one click, no pencil. Set at
     the top, so a wrapped value lines its row up on its first line, not its last. */
  .pick {
    vertical-align: top;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: text;
  }
  .pick:hover {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  /* Laid on the list's own tracks, so the field opens where the value was;
     the buttons take the line under it. */
  .in-place {
    display: contents;
  }
  .in-place .buttons {
    grid-column: 3 / -1;
    padding-bottom: var(--pad-2);
  }
  .in-place .value-field {
    width: 100%;
  }
  .new {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--pad-2) var(--pad-3);
    padding: var(--pad-2) 0;
  }
  .label-field {
    width: 8rem;
  }
  .value-field {
    width: 14rem;
    font-family: var(--font-mono);
  }
  .buttons {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .refused {
    grid-column: 1 / -1;
    flex-basis: 100%;
  }
</style>
