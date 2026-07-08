<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { isCurator } from "../session.svelte";
  import DeleteButton from "./DeleteButton.svelte";
  import { TIP, csv, aliasText, errText, type Customer } from "./shared";

  let customers = $state<Customer[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let form = $state({ slug: "", name: "", aliases: "", notes: "" });

  let editing = $state<string | null>(null);
  let edit = $state({ name: "", aliases: "", notes: "" });

  async function load() {
    loading = true;
    error = null;
    try {
      customers = await api.get("/customers");
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
      await api.post("/customers", {
        slug: form.slug, name: form.name, aliases: csv(form.aliases), notes: form.notes || undefined,
      });
      form = { slug: "", name: "", aliases: "", notes: "" };
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
      await api.patch(`/customers/${slug}`, {
        name: edit.name.trim(), aliases: csv(edit.aliases), notes: edit.notes.trim() || null,
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
    error = null;
    try {
      await api.delete(`/customers/${slug}`);
      await load();
    } catch (err) {
      error = errText(err); // "referenced by N work items" 409 shows verbatim
    }
  }

  onMount(load);
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<table>
  <thead><tr>
    <th class="tip" title={TIP.slug}>slug</th><th>name</th>
    <th class="tip" title={TIP.aliases}>aliases</th><th>notes</th>
    {#if isCurator()}<th></th>{/if}
  </tr></thead>
  <tbody>
    {#each customers as r (r.slug)}
      <tr>
        <td>{r.slug}</td>
        {#if editing === r.slug}
          <td><input class="row-edit" bind:value={edit.name} /></td>
          <td><input class="row-edit" bind:value={edit.aliases} placeholder="aliases (csv)" /></td>
          <td><input class="row-edit" bind:value={edit.notes} placeholder="notes" /></td>
          <td>
            <button class="icon-btn ok" title="save" aria-label="save" onclick={() => save(r.slug)} disabled={saving || !edit.name.trim()}>✓</button>
            <button class="icon-btn" title="cancel" aria-label="cancel" onclick={() => (editing = null)}>↺</button>
          </td>
        {:else}
          <td>{r.name}</td><td class="muted">{aliasText(r.aliases)}</td><td class="muted">{r.notes ?? ""}</td>
          {#if isCurator()}
            <td>
              <button class="icon-btn" title="edit" aria-label="edit" onclick={() => { editing = r.slug; edit = { name: r.name, aliases: aliasText(r.aliases), notes: r.notes ?? "" }; }}>✎</button>
              <DeleteButton onConfirm={() => del(r.slug)} />
            </td>
          {/if}
        {/if}
      </tr>
    {/each}
    {#if !loading && customers.length === 0}
      <tr><td colspan="5" class="muted">No customers yet - they're usually auto-registered when tickets are ingested.</td></tr>
    {/if}
  </tbody>
</table>

{#if isCurator()}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add customer</button>
    {:else}
      <form class="add-form" onsubmit={add}>
        <input placeholder="slug" bind:value={form.slug} required title={TIP.slug} />
        <input placeholder="name" bind:value={form.name} required />
        <input placeholder="aliases (comma-separated)" bind:value={form.aliases} />
        <input placeholder="notes" bind:value={form.notes} />
        <button class="icon-btn ok" type="submit" title="save" aria-label="save" disabled={saving}>{saving ? "…" : "✓"}</button>
        <button class="icon-btn" type="button" title="cancel" aria-label="cancel" onclick={() => (showForm = false)}>↺</button>
      </form>
    {/if}
  </div>
{/if}
