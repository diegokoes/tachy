<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import AsciiSelect from "../AsciiSelect.svelte";
  import RenameSlugModal from "./RenameSlugModal.svelte";
  import DeleteButton from "./DeleteButton.svelte";
  import { TIP, errText, type Label, type Product } from "./shared";

  let products = $state<Product[]>([]);
  let productSlug = $state("");
  let labels = $state<Label[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let form = $state({ slug: "", description: "" });

  let editing = $state<string | null>(null);
  let editSlug = $state("");
  let editDescription = $state("");

  let rename = $state<null | { from: string; to: string; description: string | null }>(null);

  const canEdit = $derived(canCurateScope({
    team_slug: products.find((p) => p.slug === productSlug)?.team_slug ?? null,
  }));

  async function loadProducts() {
    try {
      products = await api.get<Product[]>("/products");
      if (!productSlug && products.length) productSlug = products[0].slug;
    } catch (e) {
      error = errText(e);
    }
  }

  async function load() {
    if (!productSlug) {
      labels = [];
      return;
    }
    loading = true;
    error = null;
    try {
      labels = await api.get(`/products/${productSlug}/labels`);
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    error = null;
    try {
      await api.post(`/products/${productSlug}/labels`, { slug: form.slug, description: form.description || undefined });
      form = { slug: "", description: "" };
      showForm = false;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function save(r: Label) {
    const description = editDescription.trim() || null;
    const to = editSlug.trim();
    if (to && to !== r.slug) {
      rename = { from: r.slug, to, description };
      return;
    }
    saving = true;
    error = null;
    try {
      await api.patch(`/products/${productSlug}/labels/${r.slug}`, { description });
      editing = null;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function afterRename() {
    if (!rename) return;
    await api.patch(`/products/${productSlug}/labels/${rename.to}`, { description: rename.description });
    rename = null;
    editing = null;
    await load();
  }

  const onEditKey = (r: Label) => (e: KeyboardEvent) => {
    if (e.key === "Enter" && editSlug.trim()) save(r);
    else if (e.key === "Escape") editing = null;
  };

  async function del(slug: string) {
    error = null;
    try {
      await api.delete(`/products/${productSlug}/labels/${slug}`);
      await load();
    } catch (err) {
      error = errText(err);
    }
  }

  onMount(loadProducts);
  $effect(() => {
    void productSlug;
    editing = null;
    showForm = false;
    load();
  });
</script>

<div class="scope">
  <label>{t("product")}
    <AsciiSelect bind:value={productSlug}
      options={products.map((p) => ({ value: p.slug, label: `${p.name} (${p.team_slug})` }))} />
  </label>
</div>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<table>
  <thead><tr><th class="tip" title={TIP.slug}>slug</th><th>description</th>{#if canEdit}<th></th>{/if}</tr></thead>
  <tbody>
    {#each labels as r (r.slug)}
      <tr>
        {#if editing === r.slug}
          <td><input class="row-input" bind:value={editSlug} title="label slug" aria-label="slug" onkeydown={onEditKey(r)} /></td>
          <td><input class="row-input" bind:value={editDescription} aria-label="description" onkeydown={onEditKey(r)} /></td>
          <td class="actions">
            <button class="icon-btn ok" title="save" aria-label="save" onclick={() => save(r)} disabled={saving || !editSlug.trim()}>✓</button>
            <button class="icon-btn" title="cancel" aria-label="cancel" onclick={() => (editing = null)}>↺</button>
          </td>
        {:else}
          <td>{r.slug}</td>
          <td class="muted">{r.description ?? ""}</td>
          {#if canEdit}
            <td class="actions">
              <button class="icon-btn" title="edit" aria-label="edit" onclick={() => { editing = r.slug; editSlug = r.slug; editDescription = r.description ?? ""; }}>✎</button>
              <DeleteButton onConfirm={() => del(r.slug)} />
            </td>
          {/if}
        {/if}
      </tr>
    {/each}
    {#if !loading && labels.length === 0}<tr><td colspan="3" class="muted">No labels for this {t("product")} yet.</td></tr>{/if}
  </tbody>
</table>

{#if rename}
  <RenameSlugModal title="rename label slug"
    resource={`/products/${productSlug}/labels/${rename.from}`} to={rename.to}
    onRenamed={afterRename} onCancel={() => (rename = null)} onError={(m) => (error = m)}
    message={renameMessage} />
{/if}

{#snippet renameMessage(impact: { entries: number; docs?: number })}
  <p>Rename&nbsp; <b>{rename?.from}</b> &nbsp;-&gt;&nbsp; <b>{rename?.to}</b></p>
  <p class="muted">
    Used as a tag on {impact.entries} {impact.entries === 1 ? "entry" : "entries"}{impact.docs ? ` and ${impact.docs} reference doc${impact.docs === 1 ? "" : "s"}` : ""} — all
    will be rewritten to the new slug.
  </p>
{/snippet}

{#if canEdit && productSlug}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add label</button>
    {:else}
      <form class="add-form" onsubmit={add}>
        <input placeholder="slug" bind:value={form.slug} required title={TIP.slug} />
        <input placeholder="description" bind:value={form.description} />
        <button class="icon-btn ok" type="submit" title="save" aria-label="save" disabled={saving}>{saving ? "…" : "✓"}</button>
        <button class="icon-btn" type="button" title="cancel" aria-label="cancel" onclick={() => (showForm = false)}>↺</button>
      </form>
    {/if}
  </div>
{/if}
