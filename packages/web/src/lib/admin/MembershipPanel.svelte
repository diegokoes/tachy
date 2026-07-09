<script lang="ts">
  
  
  import { onMount } from "svelte";
  import { api } from "../api";
  import { session, canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { errText, type Team, type UserRow, type Member } from "./shared";

  const ROLE_TIP = "admin: team mini-admin - curates this team's knowledge, docs, taxonomy and members. member: uses the app.";

  let teams = $state<Team[]>([]);
  let users = $state<UserRow[]>([]);
  let membersTeam = $state("");
  let members = $state<Member[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let addEmail = $state("");
  let addRole = $state("member");
  let addFilter = $state("");

  
  const myTeams = $derived(
    session.me?.role === "admin" || !session.me
      ? teams
      : teams.filter((tm) => canCurateScope({ team_slug: tm.slug })),
  );

  const candidates = $derived(
    users
      .filter((u) => !members.some((m) => m.email === u.email))
      .filter((u) => !addFilter.trim() || u.email.toLowerCase().includes(addFilter.trim().toLowerCase())),
  );

  async function loadRefs() {
    error = null;
    try {
      teams = await api.get<Team[]>("/teams");
      users = await api.get<UserRow[]>("/users");
      if (!membersTeam && myTeams.length) membersTeam = myTeams[0].slug;
    } catch (e) {
      error = errText(e);
    }
  }

  async function loadMembers() {
    if (!membersTeam) {
      members = [];
      return;
    }
    loading = true;
    error = null;
    try {
      members = await api.get(`/users/team-members/${membersTeam}`);
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function setMember(email: string, role: string | null) {
    error = null;
    try {
      await api.put(`/users/team-members/${membersTeam}`, { email, role });
      await loadMembers();
    } catch (e) {
      error = errText(e);
      await loadMembers(); 
    }
  }

  onMount(loadRefs);
  $effect(() => {
    void membersTeam;
    loadMembers();
  });
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if myTeams.length === 0}
  <p class="muted">No {t("teams")} to manage.</p>
{:else}
  <div class="scope">
    <label>{t("team")}
      <AsciiSelect bind:value={membersTeam} options={myTeams.map((tm) => ({ value: tm.slug, label: tm.name }))} />
    </label>
  </div>

  {#if loading}<p class="muted">Loading…</p>{/if}
  <table>
    <thead><tr><th>member</th><th class="tip" title={ROLE_TIP}>team role</th><th></th></tr></thead>
    <tbody>
      {#each members as m (m.user_id)}
        <tr>
          <td>{m.email}{m.display_name ? ` (${m.display_name})` : ""}</td>
          <td>
            <AsciiSelect value={m.team_role}
              options={[
                { value: "member", label: "member" },
                { value: "admin", label: "admin (mini-admin)" },
              ]}
              onchange={(v) => setMember(m.email, String(v))} />
          </td>
          <td><button class="mini danger-btn" onclick={() => setMember(m.email, null)}>remove</button></td>
        </tr>
      {/each}
      {#if !loading && members.length === 0}<tr><td colspan="3" class="muted">No members in this {t("team")} yet.</td></tr>{/if}
    </tbody>
  </table>

  {#if users.length}
    <form class="add-form" onsubmit={(e) => { e.preventDefault(); if (addEmail) setMember(addEmail, addRole).then(() => (addEmail = "")); }}>
      {#if users.length > 10}
        <input placeholder="filter users…" bind:value={addFilter} />
      {/if}
      <label>user
        <AsciiSelect bind:value={addEmail}
          options={[{ value: "", label: "pick a user…" }, ...candidates.map((u) => u.email)]} />
      </label>
      <label class="tip" title={ROLE_TIP}>team role
        <AsciiSelect bind:value={addRole} options={["member", "admin"]} />
      </label>
      <button type="submit" disabled={!addEmail}>add to {t("team")}</button>
    </form>
  {/if}
{/if}
