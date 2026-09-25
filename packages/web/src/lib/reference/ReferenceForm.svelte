<script lang="ts">
  import { REFERENCE_STATUSES } from "../vocab";
  import type { Snippet } from "svelte";
  import { Field, FormActions } from "../tui";
  import { onMount, untrack } from "svelte";
  import type { ReferenceRow } from "../types";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { t } from "../terms";
  import { csv } from "../fields";
  import { setTopActions } from "../subnav.svelte";
  import { Filing } from "../filing.svelte";

  let {
    mode,
    initial = {},
    supersedes = null,
    saving = false,
    error = null,
    onSubmit,
    onCancel,
    extra,
  }: {
    mode: "create" | "edit";
    initial?: Partial<ReferenceRow>;
    supersedes?: string | null;
    saving?: boolean;
    error?: string | null;
    onSubmit: (payload: Record<string, unknown>) => void;
    onCancel: () => void;
    extra?: Snippet;
  } = $props();

  const SUBMIT_LABEL = $derived(mode === "create" ? "create doc" : "save changes");

  const seed = untrack(() => initial);

  let title = $state(seed.title ?? "");
  let body = $state(seed.body ?? "");
  let tags = $state((seed.tags ?? []).join(", "));
  let status = $state(seed.status ?? "approved");
  let source = $state(seed.source ?? "");
  let docVersion = $state(seed.doc_version ?? "");
  const filing = new Filing({
    ...seed,
    product_id: untrack(() => mode) === "edit" ? seed.product_id : null,
  });

  onMount(() => filing.load());

  $effect(() => setTopActions(formActions));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body,
      tags: csv(tags),
      status,
      source: source.trim() || (mode === "edit" ? null : undefined),
      docVersion: docVersion.trim() || (mode === "edit" ? null : undefined),
      ...filing.payload(mode),
    };
    if (mode === "create" && supersedes) payload.supersedes = supersedes;
    onSubmit(Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)));
  }
</script>

{#snippet formActions()}
  <FormActions form="ref-form" {saving} title={SUBMIT_LABEL} oncancel={onCancel} />
{/snippet}

<form id="ref-form" class="ref-form" onsubmit={submit}>
  {#if extra}<div class="formbar">{@render extra()}</div>{/if}
  <Field label="title" required>
    <input bind:value={title} required />
  </Field>
  <div class="row">
    <Field label="status">
      <AsciiSelect bind:value={status} options={[...REFERENCE_STATUSES]} />
    </Field>
    {#if mode === "create"}
      <Field label={t("product")}>
        <AsciiSelect
          bind:value={filing.productSlug}
          options={filing.productOptions}
          onchange={() => filing.productChanged()}
        />
      </Field>
    {/if}
    <Field label="component">
      <AsciiSelect
        bind:value={filing.component}
        disabled={!filing.productSlug || filing.components.length === 0}
        options={[{ value: "", label: "whole product" }, ...filing.componentChoices]}
      />
    </Field>
    <Field label={t("customer")}>
      <AsciiSelect bind:value={filing.customerSlug} options={filing.customerOptions}
        onchange={() => filing.customerChanged()} />
    </Field>
    <Field label="unit">
      <AsciiSelect bind:value={filing.unitSlug} options={filing.unitOptions}
        disabled={!filing.customerSlug || filing.units.length === 0} />
    </Field>
    <Field label="doc version">
      <input bind:value={docVersion} class="short" />
    </Field>
    <Field label="source">
      <input bind:value={source} />
    </Field>
  </div>
  <Field label="tags" info="Comma-separated.">
    <input bind:value={tags} />
  </Field>
  <Field label="body" required>
    <textarea rows="14" bind:value={body} required></textarea>
  </Field>
  {#if supersedes}
    <p class="hint">New version. Current doc is archived as predecessor.</p>
  {/if}

  {#if error ?? filing.error}<p class="error">{error ?? filing.error}</p>{/if}

</form>

<style>
  /* Holds only what the caller passes as `extra`, centred; absent when there
     is none. */
  .formbar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pad-2);
    margin-bottom: var(--pad-3);
    padding-bottom: var(--pad-2);
    border-bottom: var(--panel-line);
  }
  .ref-form { display: flex; flex-direction: column; gap: 0.6rem; }
  input, textarea { font: inherit; color: var(--text); }
  textarea { resize: vertical; }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
  .short { max-width: 8rem; }
  p.hint { margin: 0; color: var(--muted); font-size: 0.78rem; }
  .error { color: var(--danger); margin: 0; }
</style>
