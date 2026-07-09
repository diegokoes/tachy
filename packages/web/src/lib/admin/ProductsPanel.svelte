<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import AsciiSelect from "../AsciiSelect.svelte";
  import DeleteButton from "./DeleteButton.svelte";
  import { TIP, csv, aliasText, errText, type Team, type Product } from "./shared";

  let products = $state<Product[]>([]);
  let teams = $state<Team[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let showForm = $state(false);
  let form = $state({ team_slug: "", slug: "", name: "", aliases: "" });

  let editing = $state<string | null>(null); 
  let editName = $state("");
  let editAliases = $state("");

  
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

  
  function parseNameSlug(v: string): { name: string; slug: string } {
    const i = v.indexOf("|");
    return i === -1
      ? { name: v.trim(), slug: "" }
      : { name: v.slice(0, i).trim(), slug: v.slice(i + 1).trim() };
  }

  async function save(p: Product) {
    const { name, slug } = parseNameSlug(editName);
    if (!name) return;
    saving = true;
    error = null;
    try {
      const patch: { name: string; aliases: string[]; slug?: string } = { name, aliases: csv(editAliases) };
      if (slug && slug !== p.slug) patch.slug = slug;
      await api.patch(`/products/${p.slug}`, patch);
      editing = null;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function del(p: Product) {
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
    <th class="tip" title={TIP.slug}>name</th>
    <th class="tip" title={TIP.team}>{t("team")}</th>
    <th class="tip" title={TIP.aliases}>aliases</th>
    <th></th>
  </tr></thead>
  <tbody>
    {#each products as r (r.slug)}
      {@const onkey = (e: KeyboardEvent) => { if (e.key === "Enter" && editName.trim()) save(r); else if (e.key === "Escape") editing = null; }}
      <tr>
        <td>
          {#if editing === r.slug}
            <input class="row-input" bind:value={editName} title="format: name | slug" aria-label="{t('product')} name and slug" onkeydown={onkey} />
          {:else}{r.name} <span class="muted">({r.slug})</span>{/if}
        </td>
        <td>{r.team_slug}</td>
        <td class="muted">
          {#if editing === r.slug}
            <input class="row-input" bind:value={editAliases} placeholder="aliases (csv)" aria-label="aliases" onkeydown={onkey} />
          {:else}{aliasText(r.aliases)}{/if}
        </td>
        <td class="actions">
          {#if !canEditRow(r)}
            <!-- other team's product: read-only -->
          {:else if editing === r.slug}
            <button class="icon-btn ok" title="save" aria-label="save" onclick={() => save(r)} disabled={saving || !editName.trim()}>✓</button>
            <button class="icon-btn" title="cancel" aria-label="cancel" onclick={() => (editing = null)}>↺</button>
          {:else}
            <button class="icon-btn" title="edit" aria-label="edit" onclick={() => { editing = r.slug; editName = `${r.name} | ${r.slug}`; editAliases = aliasText(r.aliases); }}>✎</button>
            <DeleteButton onConfirm={() => del(r)} />
          {/if}
        </td>
      </tr>
    {/each}
    {#if !loading && products.length === 0}<tr><td colspan="4" class="muted">No {t("products")} yet.</td></tr>{/if}
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
        <button class="icon-btn ok" type="submit" title="save" aria-label="save" disabled={saving}>{saving ? "…" : "✓"}</button>
        <button class="icon-btn" type="button" title="cancel" aria-label="cancel" onclick={() => (showForm = false)}>↺</button>
      </form>
    {/if}
  </div>
{/if}
