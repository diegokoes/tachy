<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { session } from "../session.svelte";
  import { t } from "../terms";
  import DeleteButton from "./DeleteButton.svelte";
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

  let editing = $state<string | null>(null); 
  let editName = $state("");

  const productsOf = (teamSlug: string) => products.filter((p) => p.team_slug === teamSlug).map((p) => p.slug);

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

  
  function parseNameSlug(v: string): { name: string; slug: string } {
    const i = v.indexOf("|");
    return i === -1
      ? { name: v.trim(), slug: "" }
      : { name: v.slice(0, i).trim(), slug: v.slice(i + 1).trim() };
  }

  async function rename(teamSlug: string) {
    const { name, slug } = parseNameSlug(editName);
    if (!name) return;
    saving = true;
    error = null;
    try {
      const patch: { name: string; slug?: string } = { name };
      if (slug && slug !== teamSlug) patch.slug = slug;
      await api.patch(`/teams/${teamSlug}`, patch);
      editing = null;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function del(teamSlug: string) {
    error = null;
    try {
      await api.delete(`/teams/${teamSlug}`);
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
    <th class="tip" title="Display name. The machine slug stays under the hood - it only matters when the agent or filters reference it.">{t("team")}</th>
    <th class="tip" title={`${t("products")} owned - managed in the ${t("products")} tab`}>{t("products")}</th>
    {#if isAdmin}<th></th>{/if}
  </tr></thead>
  <tbody>
    {#each teams as r (r.slug)}
      <tr>
        <td>
          {#if editing === r.slug}
            <input class="row-input" bind:value={editName} title="format: name | slug" aria-label="{t('team')} name and slug"
              onkeydown={(e) => { if (e.key === "Enter" && editName.trim()) rename(r.slug); else if (e.key === "Escape") editing = null; }} />
          {:else}
            {r.name} <span class="muted">({r.slug})</span>
          {/if}
        </td>
        <td class="muted">[ {productsOf(r.slug).join(", ") || `no ${t("products")} yet`} ]</td>
        {#if isAdmin}
          <td class="actions">
            {#if editing === r.slug}
              <button class="icon-btn ok" title="save" aria-label="save" onclick={() => rename(r.slug)} disabled={saving || !editName.trim()}>✓</button>
              <button class="icon-btn" title="cancel" aria-label="cancel" onclick={() => (editing = null)}>↺</button>
            {:else}
              <button class="icon-btn" title="edit" aria-label="edit" onclick={() => { editing = r.slug; editName = `${r.name} | ${r.slug}`; }}>✎</button>
              <DeleteButton onConfirm={() => del(r.slug)} />
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
        <button class="icon-btn ok" type="submit" title="save" aria-label="save" disabled={saving}>{saving ? "…" : "✓"}</button>
        <button class="icon-btn" type="button" title="cancel" aria-label="cancel" onclick={() => (showForm = false)}>↺</button>
      </form>
    {/if}
  </div>
{/if}
