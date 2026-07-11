<script lang="ts">
  
  
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
  }: {
    mode: "create" | "edit";
    initial?: Partial<ReferenceRow>;
    supersedes?: string | null;
    saving?: boolean;
    error?: string | null;
    onSubmit: (payload: Record<string, unknown>) => void;
    onCancel: () => void;
  } = $props();

  
  
  const seed = untrack(() => initial);

  let title = $state(seed.title ?? "");
  let body = $state(seed.body ?? "");
  let tags = $state((seed.tags ?? []).join(", "));
  let status = $state(seed.status ?? "approved");
  let source = $state(seed.source ?? "");
  let docVersion = $state(seed.doc_version ?? "");
  let productSlug = $state("");
  let products = $state<NamedRow[]>([]);

  const productOptions = $derived([
    { value: "", label: `no ${t("product")}` },
    ...products
      .filter((p) => canCurateScope({ team_slug: (p.team_slug as string) ?? null }))
      .map((p) => ({ value: p.slug as string, label: `${p.name} (${p.team_slug})` })),
  ]);

  onMount(async () => {
    if (mode !== "create") return;
    try {
      products = await api.get<NamedRow[]>("/products");
    } catch {
      products = [];
    }
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body,
      tags: csv(tags),
      status,
      source: source.trim() || (mode === "edit" ? null : undefined),
      docVersion: docVersion.trim() || (mode === "edit" ? null : undefined),
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
  <label>title
    <input bind:value={title} required placeholder="Deployment runbook" />
  </label>
  <label>body
    <textarea rows="14" bind:value={body} required placeholder="The document text - chunked and embedded for semantic search"></textarea>
  </label>
  <label>tags <span class="hint">comma-separated</span>
    <input bind:value={tags} placeholder="runbook, deploy" />
  </label>
  <div class="row">
    <label>status
      <AsciiSelect bind:value={status} options={["approved", "draft", "archived"]} />
    </label>
    {#if mode === "create"}
      <label>{t("product")}
        <AsciiSelect bind:value={productSlug} options={productOptions} />
      </label>
    {/if}
    <label>doc version
      <input bind:value={docVersion} placeholder="e.g. 2.4" class="short" />
    </label>
    <label>source
      <input bind:value={source} placeholder="wiki, URL, 'pasted'…" />
    </label>
  </div>
  {#if supersedes}
    <p class="hint">Saving as a new version — the current doc will be archived and linked as the predecessor.</p>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}

  <div class="actions">
    <button type="submit" disabled={saving}>{saving ? "saving…" : mode === "create" ? "create doc" : "save changes"}</button>
    <button type="button" onclick={onCancel} disabled={saving}>cancel</button>
  </div>
</form>

<style>
  .ref-form { display: flex; flex-direction: column; gap: 0.6rem; }
  label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.82rem; color: var(--muted); }
  .hint { font-size: 0.72rem; opacity: 0.8; }
  input, textarea { font: inherit; color: var(--text); }
  textarea { resize: vertical; }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
  .short { max-width: 8rem; }
  p.hint { margin: 0; color: var(--muted); font-size: 0.78rem; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.25rem; }
  .error { color: var(--danger); margin: 0; }
</style>
