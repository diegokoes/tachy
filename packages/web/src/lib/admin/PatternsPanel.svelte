<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { isCurator } from "../session.svelte";
  import { TIP, errText, type Pattern } from "./shared";

  let patterns = $state<Pattern[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let form = $state({ slug: "", description: "" });

  let editing = $state<string | null>(null);
  let editDescription = $state("");
  let confirmDel = $state<string | null>(null);

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

  async function save(slug: string) {
    saving = true;
    error = null;
    try {
      await api.patch(`/resolution-patterns/${slug}`, { description: editDescription.trim() });
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
        <td>{r.slug}</td>
        {#if editing === r.slug}
          <td><input class="row-edit" bind:value={editDescription} /></td>
          <td>
            <button class="mini" onclick={() => save(r.slug)} disabled={saving || !editDescription.trim()}>save</button>
            <button class="mini" onclick={() => (editing = null)}>cancel</button>
          </td>
        {:else}
          <td class="muted">{r.description}</td>
          {#if isCurator()}
            <td>
              <button class="mini" onclick={() => { editing = r.slug; editDescription = r.description; }}>edit</button>
              <button class="mini danger-btn" onclick={() => del(r.slug)}>{confirmDel === r.slug ? "confirm?" : "del"}</button>
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

{#if isCurator()}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add pattern</button>
    {:else}
      <form class="add-form" onsubmit={add}>
        <input placeholder="slug" bind:value={form.slug} required title={TIP.slug} />
        <input placeholder="description" bind:value={form.description} required />
        <button type="submit" disabled={saving}>{saving ? "saving…" : "Save"}</button>
        <button type="button" onclick={() => (showForm = false)}>Cancel</button>
      </form>
    {/if}
  </div>
{/if}
