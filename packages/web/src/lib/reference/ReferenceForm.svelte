<script lang="ts">
  import type { Snippet } from "svelte";
  import { Button } from "../tui";
  
  
  import { onMount, untrack } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import type { ReferenceRow, NamedRow } from "../types";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { t } from "../terms";
  import { csv } from "../admin/shared";

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
  let productSlug = $state("");
  let products = $state<NamedRow[]>([]);
  // Component slugs resolve within a product, so the list is loaded per product
  // and the control stays disabled until one is picked.
  let component = $state("");
  let components = $state<NamedRow[]>([]);

  const productOptions = $derived([
    { value: "", label: `no ${t("product")}` },
    ...products
      .filter((p) => canCurateScope({ team_slug: (p.team_slug as string) ?? null }))
      .map((p) => ({ value: p.slug as string, label: `${p.name} (${p.team_slug})` })),
  ]);

  onMount(async () => {
    try {
      products = await api.get<NamedRow[]>("/products");
    } catch {
      products = [];
    }
    if (mode === "edit" && seed.product_id) {
      productSlug =
        (products.find((p) => p.id === seed.product_id)?.slug as string) ?? "";
      await loadComponents();
      // Same as EntryForm: the row carries component_id, the control speaks slugs.
      component =
        (components.find((c) => c.id === seed.component_id)?.slug as string) ??
        "";
    }
  });

  async function loadComponents() {
    component = "";
    components = [];
    if (!productSlug) return;
    try {
      components = await api.get<NamedRow[]>(
        `/products/${productSlug}/components`,
      );
    } catch {
      components = [];
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body,
      tags: csv(tags),
      status,
      source: source.trim() || (mode === "edit" ? null : undefined),
      docVersion: docVersion.trim() || (mode === "edit" ? null : undefined),
      component: component || (mode === "edit" ? null : undefined),
    };
    if (mode === "create") {
      const prod = products.find((p) => p.slug === productSlug);
      if (prod?.id) payload.productId = prod.id;
      if (supersedes) payload.supersedes = supersedes;
    }
    onSubmit(Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)));
  }
</script>

<form class="ref-form" onsubmit={submit}>
  <div class="formbar">
    <span class="side"></span>
    <span class="mid">{#if extra}{@render extra()}{/if}</span>
    <span class="side end">
      <Button
        variant="ghost"
        square
        icon="cancel"
        aria-label="cancel"
        title="cancel"
        disabled={saving}
        onclick={onCancel}
      />
      <Button
        variant="ghost"
        tone="accent"
        square
        icon="save"
        type="submit"
        aria-label={SUBMIT_LABEL}
        title={SUBMIT_LABEL}
        busy={saving}
      />
    </span>
  </div>
  <label>title
    <input bind:value={title} required />
  </label>
  <label>body
    <textarea rows="14" bind:value={body} required></textarea>
  </label>
  <label>tags <span class="hint">comma-separated</span>
    <input bind:value={tags} />
  </label>
  <div class="row">
    <label>status
      <AsciiSelect bind:value={status} options={["approved", "draft", "archived"]} />
    </label>
    {#if mode === "create"}
      <label>{t("product")}
        <AsciiSelect
          bind:value={productSlug}
          options={productOptions}
          onchange={() => loadComponents()}
        />
      </label>
    {/if}
    <label>component <span class="hint">optional</span>
      <AsciiSelect
        bind:value={component}
        disabled={!productSlug || components.length === 0}
        options={[
          { value: "", label: "whole product" },
          ...components.map((c) => c.slug as string),
        ]}
      />
    </label>
    <label>doc version
      <input bind:value={docVersion} class="short" />
    </label>
    <label>source
      <input bind:value={source} />
    </label>
  </div>
  {#if supersedes}
    <p class="hint">Saving as a new version — the current doc will be archived and linked as the predecessor.</p>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}

</form>

<style>
  /* Three tracks so the middle group stays optically centred whatever the
     actions on the right weigh. */
  .formbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--pad-2);
    margin-bottom: var(--pad-3);
    padding-bottom: var(--pad-2);
    border-bottom: var(--panel-line);
  }
  .formbar .mid,
  .formbar .side {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .formbar .side.end { justify-content: flex-end; }
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
