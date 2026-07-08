<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { TIP, csv, aliasText, errText, type Component, type Product } from "./shared";

  let products = $state<Product[]>([]);
  let productSlug = $state("");
  let components = $state<Component[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let form = $state({ slug: "", name: "", parent: "", description: "", aliases: "" });

  let editing = $state<string | null>(null); // component slug
  let edit = $state({ name: "", parent: "", description: "", aliases: "" });
  let confirmDel = $state<string | null>(null);

  const parentSlugOf = (c: Component) => components.find((p) => p.id === c.parent_id)?.slug ?? "";
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
      components = [];
      return;
    }
    loading = true;
    error = null;
    try {
      components = await api.get(`/products/${productSlug}/components`);
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
      await api.post(`/products/${productSlug}/components`, {
        slug: form.slug, name: form.name,
        parentSlug: form.parent || undefined, description: form.description || undefined, aliases: csv(form.aliases),
      });
      form = { slug: "", name: "", parent: "", description: "", aliases: "" };
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
      await api.patch(`/products/${productSlug}/components/${slug}`, {
        name: edit.name.trim(),
        parentSlug: edit.parent || null,
        description: edit.description.trim() || null,
        aliases: csv(edit.aliases),
      });
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
      await api.delete(`/products/${productSlug}/components/${slug}`);
      await load();
    } catch (err) {
      error = errText(err); // guarded 409 shows verbatim
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
  <thead><tr>
    <th class="tip" title={TIP.slug}>slug</th><th>name</th>
    <th class="tip" title={TIP.parent}>parent</th>
    <th class="tip" title={TIP.aliases}>aliases</th><th>description</th>
    {#if canEdit}<th></th>{/if}
  </tr></thead>
  <tbody>
    {#each components as r (r.slug)}
      <tr>
        <td>{r.slug}</td>
        {#if editing === r.slug}
          <td><input class="row-edit" bind:value={edit.name} /></td>
          <td>
            <select bind:value={edit.parent}>
              <option value="">(none)</option>
              {#each components.filter((c) => c.slug !== r.slug) as p}<option value={p.slug}>{p.slug}</option>{/each}
            </select>
          </td>
          <td><input class="row-edit" bind:value={edit.aliases} placeholder="aliases (csv)" /></td>
          <td><input class="row-edit" bind:value={edit.description} placeholder="description" /></td>
          <td>
            <button class="mini" onclick={() => save(r.slug)} disabled={saving || !edit.name.trim()}>save</button>
            <button class="mini" onclick={() => (editing = null)}>cancel</button>
          </td>
        {:else}
          <td>{r.name}</td><td class="muted">{parentSlugOf(r)}</td>
          <td class="muted">{aliasText(r.aliases)}</td><td class="muted">{r.description ?? ""}</td>
          {#if canEdit}
            <td>
              <button class="mini" onclick={() => {
                editing = r.slug;
                edit = { name: r.name, parent: parentSlugOf(r), description: r.description ?? "", aliases: aliasText(r.aliases) };
              }}>edit</button>
              <button class="mini danger-btn" onclick={() => del(r.slug)}>{confirmDel === r.slug ? "confirm?" : "del"}</button>
            </td>
          {/if}
        {/if}
      </tr>
    {/each}
    {#if !loading && components.length === 0}
      <tr><td colspan="6" class="muted">No components for this {t("product")} yet - seed them from docs via Chat, or add one below.</td></tr>
    {/if}
  </tbody>
</table>

{#if canEdit && productSlug}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add component</button>
    {:else}
      <form class="add-form" onsubmit={add}>
        <input placeholder="slug" bind:value={form.slug} required title={TIP.slug} />
        <input placeholder="name" bind:value={form.name} required />
        <label>parent
          <select bind:value={form.parent}>
            <option value="">(none)</option>
            {#each components as p}<option value={p.slug}>{p.slug}</option>{/each}
          </select>
        </label>
        <input placeholder="aliases (comma-separated)" bind:value={form.aliases} />
        <input placeholder="description" bind:value={form.description} />
        <button type="submit" disabled={saving}>{saving ? "saving…" : "Save"}</button>
        <button type="button" onclick={() => (showForm = false)}>Cancel</button>
      </form>
      <p class="muted hint">Slugs are what entries anchor to - pick stable, lowercase names; use aliases for naming variants (lc, LC, line controller).</p>
    {/if}
  </div>
{/if}
