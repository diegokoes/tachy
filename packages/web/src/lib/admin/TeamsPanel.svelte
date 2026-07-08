<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { session } from "../session.svelte";
  import { t } from "../terms";
  import { TIP, errText, type Team, type Product } from "./shared";

  const isAdmin = $derived(session.me?.role === "admin" || !session.me);

  let teams = $state<Team[]>([]);
  let products = $state<Product[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let slug = $state("");
  let name = $state("");

  let editing = $state<string | null>(null); // team slug being renamed
  let editName = $state("");
  let confirmDel = $state<string | null>(null);

  const productsOf = (teamSlug: string) => products.filter((p) => p.team_slug === teamSlug).map((p) => p.name);

  async function load() {
    loading = true;
    error = null;
    try {
      [teams, products] = await Promise.all([api.get<Team[]>("/teams"), api.get<Product[]>("/products")]);
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
      await api.post("/teams", { slug, name });
      slug = name = "";
      showForm = false;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function rename(teamSlug: string) {
    saving = true;
    error = null;
    try {
      await api.patch(`/teams/${teamSlug}`, { name: editName.trim() });
      editing = null;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function del(teamSlug: string) {
    if (confirmDel !== teamSlug) {
      confirmDel = teamSlug;
      return;
    }
    confirmDel = null;
    error = null;
    try {
      await api.delete(`/teams/${teamSlug}`);
      await load();
    } catch (err) {
      error = errText(err); // guarded 409s surface verbatim
    }
  }

  onMount(load);
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<table>
  <thead><tr>
    <th class="tip" title="Display name. The machine slug stays under the hood - it only matters when the agent or filters reference it.">{t("team")}</th>
    <th class="tip" title={`${t("products")} owned - managed in the ${t("products")} tab`}>{t("products")}</th>
    {#if isAdmin}<th></th>{/if}
  </tr></thead>
  <tbody>
    {#each teams as r (r.slug)}
      <tr>
        <td>
          {#if editing === r.slug}
            <span class="row-edit">
              <input bind:value={editName} />
              <button class="mini" onclick={() => rename(r.slug)} disabled={saving || !editName.trim()}>save</button>
              <button class="mini" onclick={() => (editing = null)}>cancel</button>
            </span>
          {:else}
            {r.name} <span class="muted">({r.slug})</span>
          {/if}
        </td>
        <td class="muted">[ {productsOf(r.slug).join(", ") || `no ${t("products")} yet`} ]</td>
        {#if isAdmin}
          <td>
            {#if editing !== r.slug}
              <button class="mini" onclick={() => { editing = r.slug; editName = r.name; }}>edit</button>
              <button class="mini danger-btn" onclick={() => del(r.slug)}>
                {confirmDel === r.slug ? "confirm?" : "del"}
              </button>
            {/if}
          </td>
        {/if}
      </tr>
    {/each}
    {#if !loading && teams.length === 0}<tr><td colspan="3" class="muted">No {t("teams")} yet.</td></tr>{/if}
  </tbody>
</table>

{#if isAdmin}
  <div class="add-area">
    {#if !showForm}
      <button onclick={() => (showForm = true)}>+ add {t("team")}</button>
    {:else}
      <form class="add-form" onsubmit={add}>
        <input placeholder="slug" bind:value={slug} required title={TIP.slug} />
        <input placeholder="name" bind:value={name} required />
        <button type="submit" disabled={saving}>{saving ? "saving…" : "Save"}</button>
        <button type="button" onclick={() => (showForm = false)}>Cancel</button>
      </form>
    {/if}
  </div>
{/if}
