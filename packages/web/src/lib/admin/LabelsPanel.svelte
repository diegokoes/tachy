<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import AsciiSelect from "../AsciiSelect.svelte";
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
  let editDescription = $state("");
  let confirmDel = $state<string | null>(null);

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

  async function save(slug: string) {
    saving = true;
    error = null;
    try {
      await api.patch(`/products/${productSlug}/labels/${slug}`, { description: editDescription.trim() || null });
      editing = null;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function del(slug: string) {
    if (confirmDel !== slug) {
      confirmDel = slug;
      return;
    }
    confirmDel = null;
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
        <td>{r.slug}</td>
        {#if editing === r.slug}
          <td><input class="row-edit" bind:value={editDescription} /></td>
          <td>
            <button class="mini" onclick={() => save(r.slug)} disabled={saving}>save</button>
            <button class="mini" onclick={() => (editing = null)}>cancel</button>
          </td>
        {:else}
          <td class="muted">{r.description ?? ""}</td>
          {#if canEdit}
            <td>
              <button class="mini" onclick={() => { editing = r.slug; editDescription = r.description ?? ""; }}>edit</button>
              <button class="mini danger-btn" onclick={() => del(r.slug)}>{confirmDel === r.slug ? "confirm?" : "del"}</button>
            </td>
          {/if}
        {/if}
      </tr>
    {/each}
    {#if !loading && labels.length === 0}<tr><td colspan="3" class="muted">No labels for this {t("product")} yet.</td></tr>{/if}
  </tbody>
</table>

{#if canEdit && productSlug}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add label</button>
    {:else}
      <form class="add-form" onsubmit={add}>
        <input placeholder="slug" bind:value={form.slug} required title={TIP.slug} />
        <input placeholder="description" bind:value={form.description} />
        <button type="submit" disabled={saving}>{saving ? "saving…" : "Save"}</button>
        <button type="button" onclick={() => (showForm = false)}>Cancel</button>
      </form>
    {/if}
  </div>
{/if}
