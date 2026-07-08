<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { TIP, csv, aliasText, errText, type Team, type Product } from "./shared";

  let products = $state<Product[]>([]);
  let teams = $state<Team[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let form = $state({ team_slug: "", slug: "", name: "", aliases: "" });

  let editing = $state<string | null>(null); // product slug
  let editName = $state("");
  let editAliases = $state("");
  let confirmDel = $state<string | null>(null);

  // mini-admins only create/edit within their teams; the server enforces too
  const myTeams = $derived(teams.filter((tm) => canCurateScope({ team_slug: tm.slug })));
  const canEditRow = (p: Product) => canCurateScope({ team_slug: p.team_slug });

  async function load() {
    loading = true;
    error = null;
    try {
      [products, teams] = await Promise.all([api.get<Product[]>("/products"), api.get<Team[]>("/teams")]);
      if (!form.team_slug && myTeams.length) form.team_slug = myTeams[0].slug;
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
      await api.post("/products", {
        team_slug: form.team_slug, slug: form.slug, name: form.name, aliases: csv(form.aliases),
      });
      form = { ...form, slug: "", name: "", aliases: "" };
      showForm = false;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function save(p: Product) {
    saving = true;
    error = null;
    try {
      await api.patch(`/products/${p.slug}`, { name: editName.trim(), aliases: csv(editAliases) });
      editing = null;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function del(p: Product) {
    if (confirmDel !== p.slug) {
      confirmDel = p.slug;
      return;
    }
    confirmDel = null;
    error = null;
    try {
      await api.delete(`/products/${p.slug}`);
      await load();
    } catch (err) {
      error = errText(err);
    }
  }

  onMount(load);
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<table>
  <thead><tr>
    <th class="tip" title={TIP.slug}>slug</th><th>name</th>
    <th class="tip" title={TIP.team}>{t("team")}</th>
    <th class="tip" title={TIP.aliases}>aliases</th>
    <th></th>
  </tr></thead>
  <tbody>
    {#each products as r (r.slug)}
      <tr>
        <td>{r.slug}</td>
        <td>
          {#if editing === r.slug}
            <input class="row-edit" bind:value={editName} />
          {:else}{r.name}{/if}
        </td>
        <td>{r.team_slug}</td>
        <td class="muted">
          {#if editing === r.slug}
            <input class="row-edit" bind:value={editAliases} placeholder="aliases (csv)" />
          {:else}{aliasText(r.aliases)}{/if}
        </td>
        <td>
          {#if !canEditRow(r)}
            <!-- other team's product: read-only -->
          {:else if editing === r.slug}
            <button class="mini" onclick={() => save(r)} disabled={saving || !editName.trim()}>save</button>
            <button class="mini" onclick={() => (editing = null)}>cancel</button>
          {:else}
            <button class="mini" onclick={() => { editing = r.slug; editName = r.name; editAliases = aliasText(r.aliases); }}>edit</button>
            <button class="mini danger-btn" onclick={() => del(r)}>{confirmDel === r.slug ? "confirm?" : "del"}</button>
          {/if}
        </td>
      </tr>
    {/each}
    {#if !loading && products.length === 0}<tr><td colspan="5" class="muted">No {t("products")} yet.</td></tr>{/if}
  </tbody>
</table>

{#if myTeams.length}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add {t("product")}</button>
    {:else}
      <form class="add-form" onsubmit={add}>
        <label>{t("team")}
          <AsciiSelect bind:value={form.team_slug} options={myTeams.map((tm) => ({ value: tm.slug, label: tm.name }))} />
        </label>
        <input placeholder="slug" bind:value={form.slug} required title={TIP.slug} />
        <input placeholder="name" bind:value={form.name} required />
        <input placeholder="aliases (comma-separated)" bind:value={form.aliases} />
        <button type="submit" disabled={saving}>{saving ? "saving…" : "Save"}</button>
        <button type="button" onclick={() => (showForm = false)}>Cancel</button>
      </form>
    {/if}
  </div>
{/if}
