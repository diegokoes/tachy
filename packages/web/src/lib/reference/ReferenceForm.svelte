<script lang="ts">
  import { REFERENCE_STATUSES } from "../vocab";
  import type { Snippet } from "svelte";
  import { FormActions } from "../tui";
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
  <label>title
    <input bind:value={title} required />
  </label>
  <div class="row">
    <label>status
      <AsciiSelect bind:value={status} options={[...REFERENCE_STATUSES]} />
    </label>
    {#if mode === "create"}
      <label>{t("product")}
        <AsciiSelect
          bind:value={filing.productSlug}
          options={filing.productOptions}
          onchange={() => filing.productChanged()}
        />
      </label>
    {/if}
    <label>component <span class="hint">optional</span>
      <AsciiSelect
        bind:value={filing.component}
        disabled={!filing.productSlug || filing.components.length === 0}
        options={[{ value: "", label: "whole product" }, ...filing.componentChoices]}
      />
    </label>
    <label>{t("customer")} <span class="hint">optional</span>
      <AsciiSelect bind:value={filing.customerSlug} options={filing.customerOptions}
        onchange={() => filing.customerChanged()} />
    </label>
    <label>unit <span class="hint">optional</span>
      <AsciiSelect bind:value={filing.unitSlug} options={filing.unitOptions}
        disabled={!filing.customerSlug || filing.units.length === 0} />
    </label>
    <label>doc version
      <input bind:value={docVersion} class="short" />
    </label>
    <label>source
      <input bind:value={source} />
    </label>
  </div>
  <label>tags <span class="hint">comma-separated</span>
    <input bind:value={tags} />
  </label>
  <label>body
    <textarea rows="14" bind:value={body} required></textarea>
  </label>
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
  label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.82rem; color: var(--muted); }
  .hint { font-size: 0.72rem; opacity: 0.8; }
  input, textarea { font: inherit; color: var(--text); }
  textarea { resize: vertical; }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
  .short { max-width: 8rem; }
  p.hint { margin: 0; color: var(--muted); font-size: 0.78rem; }
  .error { color: var(--danger); margin: 0; }
</style>
