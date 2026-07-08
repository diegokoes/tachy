<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { errText, type UserRow } from "./shared";

  const PAGE = 25;

  let users = $state<UserRow[]>([]);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let filter = $state("");
  let page = $state(0);

  let showForm = $state(false);
  let form = $state({ email: "", name: "", password: "", role: "member" });

  let pwFor = $state<string | null>(null); // user id with the set-password input open
  let pwValue = $state("");

  const filtered = $derived(
    filter.trim()
      ? users.filter((u) =>
          `${u.email} ${u.display_name ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()))
      : users,
  );
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / PAGE)));
  const pageRows = $derived(filtered.slice(Math.min(page, pages - 1) * PAGE, Math.min(page, pages - 1) * PAGE + PAGE));

  async function load() {
    loading = true;
    error = null;
    try {
      users = await api.get<UserRow[]>("/users");
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
      await api.post("/users", {
        email: form.email,
        display_name: form.name || undefined,
        password: form.password || undefined,
        role: form.role,
      });
      form = { email: "", name: "", password: "", role: "member" };
      showForm = false;
      await load();
    } catch (err) {
      error = errText(err);
    } finally {
      saving = false;
    }
  }

  async function patchUser(id: string, patch: Record<string, unknown>) {
    error = null;
    try {
      await api.patch(`/users/${id}`, patch);
      users = await api.get("/users");
    } catch (e) {
      error = errText(e);
      users = await api.get("/users"); // revert optimistic select/checkbox state
    }
  }

  $effect(() => {
    void filter;
    page = 0;
  });

  onMount(load);
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<div class="scope">
  <input placeholder="filter by email or name…" bind:value={filter} />
  {#if pages > 1}
    <span class="pager">
      <button class="mini" onclick={() => (page = Math.max(0, page - 1))} disabled={page === 0}>‹</button>
      <span class="muted">{page + 1}/{pages}</span>
      <button class="mini" onclick={() => (page = Math.min(pages - 1, page + 1))} disabled={page >= pages - 1}>›</button>
    </span>
  {/if}
  <span class="muted">{filtered.length} user(s)</span>
</div>

<table>
  <thead><tr>
    <th>email</th><th>name</th>
    <th class="tip" title="admin: manage users, org structure and settings. member: use the app (team roles can add scoped curation).">role</th>
    <th class="tip" title="Whether email+password login is set up for this user. SSO users don't need one.">password</th>
    <th class="tip" title="Disabled users cannot sign in (their past activity stays attributed).">disabled</th>
  </tr></thead>
  <tbody>
    {#each pageRows as u (u.id)}
      <tr class:dim={u.disabled}>
        <td>{u.email}</td>
        <td class="muted">{u.display_name ?? ""}</td>
        <td>
          <AsciiSelect value={u.role} options={["admin", "member"]}
            onchange={(v) => patchUser(u.id, { role: v })} />
        </td>
        <td>
          {#if pwFor === u.id}
            <form class="pw-form" onsubmit={(e) => { e.preventDefault(); patchUser(u.id, { password: pwValue }).then(() => { pwFor = null; pwValue = ""; }); }}>
              <input type="password" placeholder="new password (min 10)" bind:value={pwValue} />
              <button type="submit" disabled={pwValue.length < 10}>set</button>
              <button type="button" onclick={() => { pwFor = null; pwValue = ""; }}>cancel</button>
            </form>
          {:else}
            <span class="muted">{u.has_password ? "set" : "none"}</span>
            <button class="mini" onclick={() => { pwFor = u.id; pwValue = ""; }}>{u.has_password ? "reset" : "set"}…</button>
          {/if}
        </td>
        <td>
          <input type="checkbox" checked={u.disabled}
            onchange={(e) => patchUser(u.id, { disabled: (e.target as HTMLInputElement).checked })} />
        </td>
      </tr>
    {/each}
    {#if !loading && filtered.length === 0}
      <tr><td colspan="5" class="muted">{users.length === 0 ? "No users yet - run the setup wizard, or add one below." : "No users match the filter."}</td></tr>
    {/if}
  </tbody>
</table>

<div class="add-area">
  {#if !showForm}
    <button onclick={() => (showForm = true)}>+ add user</button>
  {:else}
    <form class="add-form" onsubmit={add}>
      <input type="email" placeholder="email" bind:value={form.email} required />
      <input placeholder="display name" bind:value={form.name} />
      <input type="password" placeholder="password (optional, min 10)" bind:value={form.password} />
      <label>role
        <AsciiSelect bind:value={form.role} options={["member", "admin"]} />
      </label>
      <button type="submit" disabled={saving}>{saving ? "saving…" : "Save"}</button>
      <button type="button" onclick={() => (showForm = false)}>Cancel</button>
    </form>
    <p class="muted hint">No password = SSO-only (or attribution-only) user; a password can be set later.</p>
  {/if}
</div>

<style>
  .pw-form { display: flex; gap: 0.4rem; align-items: center; }
  .pw-form input { min-width: 11rem; }
  .pager { display: inline-flex; gap: 0.35rem; align-items: center; }
  tr.dim td { opacity: 0.55; }
  .scope input { min-width: 15rem; }
</style>
