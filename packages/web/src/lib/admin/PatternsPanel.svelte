<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { isCurator } from "../session.svelte";
  import RenameSlugModal from "./RenameSlugModal.svelte";
  import DeleteButton from "./DeleteButton.svelte";
  import { TIP, errText, type Pattern } from "./shared";

  let patterns = $state<Pattern[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let form = $state({ slug: "", description: "" });

  let editing = $state<string | null>(null);
  let editSlug = $state("");
  let editDescription = $state("");

  // Pending slug rename awaiting confirmation; RenameSlugModal fetches the impact.
  let rename = $state<null | { from: string; to: string; description: string }>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      patterns = await api.get("/resolution-patterns");
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
      await api.post("/resolution-patterns", { slug: form.slug, description: form.description });
      form = { slug: "", description: "" };
      showForm = false;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function save(r: Pattern) {
    const description = editDescription.trim();
    const to = editSlug.trim();
    // A slug change cascades to referencing entries — hand off to the confirm modal.
    if (to && to !== r.slug) {
      rename = { from: r.slug, to, description };
      return;
    }
    saving = true;
    error = null;
    try {
      await api.patch(`/resolution-patterns/${r.slug}`, { description });
      editing = null;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  // Applied after the slug rename succeeds: keep the (possibly edited) description.
  async function afterRename() {
    if (!rename) return;
    if (rename.description) await api.patch(`/resolution-patterns/${rename.to}`, { description: rename.description });
    rename = null;
    editing = null;
    await load();
  }

  const onEditKey = (r: Pattern) => (e: KeyboardEvent) => {
    if (e.key === "Enter" && editSlug.trim() && editDescription.trim()) save(r);
    else if (e.key === "Escape") editing = null;
  };

  async function del(slug: string) {
    error = null;
    try {
      await api.delete(`/resolution-patterns/${slug}`);
      await load();
    } catch (err) {
      error = errText(err); // "used by N entries" 409 shows verbatim
    }
  }

  onMount(load);
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<table>
  <thead><tr><th class="tip" title={TIP.slug}>slug</th><th>description</th>{#if isCurator()}<th></th>{/if}</tr></thead>
  <tbody>
    {#each patterns as r (r.slug)}
      <tr>
        {#if editing === r.slug}
          <td><input class="row-input" bind:value={editSlug} title="pattern slug" aria-label="slug" onkeydown={onEditKey(r)} /></td>
          <td><input class="row-input" bind:value={editDescription} aria-label="description" onkeydown={onEditKey(r)} /></td>
          <td class="actions">
            <button class="icon-btn ok" title="save" aria-label="save" onclick={() => save(r)} disabled={saving || !editDescription.trim() || !editSlug.trim()}>✓</button>
            <button class="icon-btn" title="cancel" aria-label="cancel" onclick={() => (editing = null)}>↺</button>
          </td>
        {:else}
          <td>{r.slug}</td>
          <td class="muted">{r.description}</td>
          {#if isCurator()}
            <td class="actions">
              <button class="icon-btn" title="edit" aria-label="edit" onclick={() => { editing = r.slug; editSlug = r.slug; editDescription = r.description; }}>✎</button>
              <DeleteButton onConfirm={() => del(r.slug)} />
            </td>
          {/if}
        {/if}
      </tr>
    {/each}
    {#if !loading && patterns.length === 0}
      <tr><td colspan="3" class="muted">No resolution patterns yet - this controlled vocabulary grows only on explicit request.</td></tr>
    {/if}
  </tbody>
</table>

{#if rename}
  <RenameSlugModal title="rename pattern slug"
    resource={`/resolution-patterns/${rename.from}`} to={rename.to}
    onRenamed={afterRename} onCancel={() => (rename = null)} onError={(m) => (error = m)}
    message={renameMessage} />
{/if}

{#snippet renameMessage(impact: { entries: number })}
  <p>Rename&nbsp; <b>{rename?.from}</b> &nbsp;-&gt;&nbsp; <b>{rename?.to}</b></p>
  <p class="muted">
    {impact.entries} knowledge {impact.entries === 1 ? "entry" : "entries"} reference this pattern and will be
    rewritten to the new slug.
  </p>
{/snippet}

{#if isCurator()}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add pattern</button>
    {:else}
      <form class="add-form" onsubmit={add}>
        <input placeholder="slug" bind:value={form.slug} required title={TIP.slug} />
        <input placeholder="description" bind:value={form.description} required />
        <button class="icon-btn ok" type="submit" title="save" aria-label="save" disabled={saving}>{saving ? "…" : "✓"}</button>
        <button class="icon-btn" type="button" title="cancel" aria-label="cancel" onclick={() => (showForm = false)}>↺</button>
      </form>
    {/if}
  </div>
{/if}
