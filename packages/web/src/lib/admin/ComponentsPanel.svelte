<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import AsciiSelect from "../AsciiSelect.svelte";
  import RenameSlugModal from "./RenameSlugModal.svelte";
  import DeleteButton from "./DeleteButton.svelte";
  import { TIP, csv, aliasText, errText, type Component, type Product, type Repo } from "./shared";

  let products = $state<Product[]>([]);
  let productSlug = $state("");
  let components = $state<Component[]>([]);
  let repos = $state<Repo[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let form = $state({ slug: "", name: "", parent: "", description: "", aliases: "" });

  let editing = $state<string | null>(null); 
  let edit = $state({ slug: "", name: "", parent: "", description: "", aliases: "" });

  let rename = $state<null | { from: string; to: string }>(null);

  const parentSlugOf = (c: Component) => components.find((p) => p.id === c.parent_id)?.slug ?? "";
  const reposOf = (c: Component) => repos.filter((r) => r.component_id === c.id);
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
      repos = (
        await api.get<{ repos: Repo[] }>(`/repos?product_slug=${productSlug}`)
      ).repos;
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

  function editPatch() {
    return {
      name: edit.name.trim(),
      parentSlug: edit.parent || null,
      description: edit.description.trim() || null,
      aliases: csv(edit.aliases),
    };
  }

  async function save(r: Component) {
    const to = edit.slug.trim();
    
    if (to && to !== r.slug) {
      rename = { from: r.slug, to };
      return;
    }
    saving = true;
    error = null;
    try {
      await api.patch(`/products/${productSlug}/components/${r.slug}`, editPatch());
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
    await api.patch(`/products/${productSlug}/components/${rename.to}`, editPatch());
    rename = null;
    editing = null;
    await load();
  }

  const onEditKey = (r: Component) => (e: KeyboardEvent) => {
    if (e.key === "Enter" && edit.slug.trim() && edit.name.trim()) save(r);
    else if (e.key === "Escape") editing = null;
  };

  async function del(slug: string) {
    error = null;
    try {
      await api.delete(`/products/${productSlug}/components/${slug}`);
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
  <thead><tr>
    <th class="tip" title={TIP.slug}>slug</th><th>name</th>
    <th class="tip" title={TIP.parent}>parent</th>
    <th class="tip" title={TIP.aliases}>aliases</th><th>description</th>
    <th class="tip" title={TIP.repoComponent}>code</th>
    {#if canEdit}<th></th>{/if}
  </tr></thead>
  <tbody>
    {#each components as r (r.slug)}
      <tr>
        {#if editing === r.slug}
          <td><input class="row-input" bind:value={edit.slug} title="component slug" aria-label="slug" onkeydown={onEditKey(r)} /></td>
          <td><input class="row-input" bind:value={edit.name} aria-label="name" onkeydown={onEditKey(r)} /></td>
          <td>
            <select bind:value={edit.parent}>
              <option value="">(none)</option>
              {#each components.filter((c) => c.slug !== r.slug) as p}<option value={p.slug}>{p.slug}</option>{/each}
            </select>
          </td>
          <td><input class="row-input" bind:value={edit.aliases} placeholder="aliases (csv)" aria-label="aliases" onkeydown={onEditKey(r)} /></td>
          <td><input class="row-input" bind:value={edit.description} placeholder="description" aria-label="description" onkeydown={onEditKey(r)} /></td>
          <td class="muted">{reposOf(r).map((x) => x.slug).join(", ")}</td>
          <td class="actions">
            <button class="icon-btn ok" title="save" aria-label="save" onclick={() => save(r)} disabled={saving || !edit.name.trim() || !edit.slug.trim()}>✓</button>
            <button class="icon-btn" title="cancel" aria-label="cancel" onclick={() => (editing = null)}>↺</button>
          </td>
        {:else}
          <td>{r.slug}</td>
          <td>{r.name}</td><td class="muted">{parentSlugOf(r)}</td>
          <td class="muted">{aliasText(r.aliases)}</td><td class="muted">{r.description ?? ""}</td>
          <td>
            {#each reposOf(r) as repo (repo.id)}
              <span class="repo" class:stale={repo.index_status !== "ready"}
                title={`${repo.index_status}${repo.last_indexed_at ? ` — indexed ${new Date(repo.last_indexed_at).toLocaleDateString()}` : ", never indexed"}`}
              >{repo.slug}</span>
            {/each}
            {#if !reposOf(r).length}<span class="muted">—</span>{/if}
          </td>
          {#if canEdit}
            <td class="actions">
              <button class="icon-btn" title="edit" aria-label="edit" onclick={() => {
                editing = r.slug;
                edit = { slug: r.slug, name: r.name, parent: parentSlugOf(r), description: r.description ?? "", aliases: aliasText(r.aliases) };
              }}>✎</button>
              <DeleteButton onConfirm={() => del(r.slug)} />
            </td>
          {/if}
        {/if}
      </tr>
    {/each}
    {#if !loading && components.length === 0}
      <tr><td colspan="7" class="muted">No components for this {t("product")} yet - seed them from docs via Chat, or add one below.</td></tr>
    {/if}
  </tbody>
</table>

{#if rename}
  <RenameSlugModal title="rename component slug"
    resource={`/products/${productSlug}/components/${rename.from}`} to={rename.to}
    onRenamed={afterRename} onCancel={() => (rename = null)} onError={(m) => (error = m)}
    message={renameMessage} />
{/if}

{#snippet renameMessage(impact: { entries: number; docs?: number })}
  <p>Rename&nbsp; <b>{rename?.from}</b> &nbsp;-&gt;&nbsp; <b>{rename?.to}</b></p>
  <p class="muted">
    Entries link by id (unaffected), but the slug tags {impact.entries} {impact.entries === 1 ? "entry" : "entries"}{impact.docs ? ` and ${impact.docs} reference doc${impact.docs === 1 ? "" : "s"}` : ""} — those
    tags will be rewritten.
  </p>
{/snippet}

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
        <button class="icon-btn ok" type="submit" title="save" aria-label="save" disabled={saving}>{saving ? "…" : "✓"}</button>
        <button class="icon-btn" type="button" title="cancel" aria-label="cancel" onclick={() => (showForm = false)}>↺</button>
      </form>
      <p class="muted hint">Slugs are what entries anchor to - pick stable, lowercase names; use aliases for naming variants (lc, LC, line controller).</p>
    {/if}
  </div>
{/if}

<style>
  /* A component's repos, so it is clear what code backs it and how fresh the
     index is — a stale one means code answers may be out of date. */
  .repo { font-size: 0.75rem; padding: 0.1rem 0.4rem; border: 1px solid var(--border); border-radius: 0.6rem; margin-right: 0.25rem; white-space: nowrap; }
  .repo.stale { border-color: var(--warn); color: var(--warn); }
</style>
