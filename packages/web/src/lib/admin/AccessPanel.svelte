<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { session, isGlobalAdmin, canCurateScope } from "../session.svelte";
  import { t } from "../terms";
  import {
    Badge,
    Button,
    Chip,
    CrudTable,
    Field,
    Select,
    type Column,
  } from "../tui";
  import type { Member, Team, UserRow } from "./shared";

  type Membership = {
    user_id: string;
    team_slug: string;
    team_name: string;
    team_role: "admin" | "member";
  };

  const ROLE_TIP =
    "app admin: manages users, org structure and system settings. member: uses the app — curation comes from a team role.";
  const TEAM_ROLE_TIP = `team admin: curates this ${t("team")}'s knowledge, docs, taxonomy and members. member: uses the app.`;

  const users = createResource(() => api.get<UserRow[]>("/users"), []);
  const teams = createResource(() => api.get<Team[]>("/teams"), []);
  const memberships = createResource(
    () => api.get<Membership[]>("/users/memberships"),
    [],
  );

  const admin = $derived(isGlobalAdmin());
  /** A team admin manages their own team's roster but not the user records. */
  const myTeams = $derived(
    admin ? teams.data : teams.data.filter((tm) => canCurateScope({ team_slug: tm.slug })),
  );

  let filter = $state("");

  const teamsOf = (u: UserRow) =>
    memberships.data.filter((m) => m.user_id === u.id);

  const filtered = $derived(
    filter.trim()
      ? users.data.filter((u) =>
          `${u.email} ${u.display_name ?? ""}`
            .toLowerCase()
            .includes(filter.trim().toLowerCase()),
        )
      : users.data,
  );

  /* Membership lives on its own endpoint, so the form edits a copy and the
     save fans the differences out afterwards. */
  let roster = $state<Record<string, "admin" | "member">>({});
  let rosterFor = $state<string | null>(null);
  let addTeam = $state("");

  function openedForm(f: { mode: "create" | "edit"; row: UserRow | null } | null) {
    rosterFor = f?.row?.id ?? null;
    addTeam = "";
    roster = {};
    if (f?.row)
      for (const m of teamsOf(f.row)) roster[m.team_slug] = m.team_role;
  }

  async function applyRoster(u: UserRow) {
    const before = new Map(teamsOf(u).map((m) => [m.team_slug, m.team_role]));
    for (const [slug, role] of Object.entries(roster))
      if (before.get(slug) !== role)
        await api.put(`/users/team-members/${slug}`, { email: u.email, role });
    for (const slug of before.keys())
      if (!(slug in roster))
        await api.put(`/users/team-members/${slug}`, {
          email: u.email,
          role: null,
        });
  }

  const columns: Column<UserRow>[] = $derived([
    {
      key: "email",
      label: "user",
      width: "18rem",
      edit: "text",
      required: true,
      editable: () => false,
      hint: "sign-in identity — cannot change later",
    },
    { key: "display_name", label: "name", width: "12rem", edit: "text" },
    {
      key: "role",
      label: "app role",
      width: "9rem",
      edit: "select",
      options: [
        { value: "member", label: "member" },
        { value: "admin", label: "admin" },
      ],
      initial: "member",
      hint: "org-wide",
      info: ROLE_TIP,
    },
    { key: "teams", label: t("teams"), cell: teamsCell },
    {
      key: "password",
      label: "password",
      width: "8rem",
      formOnly: true,
      edit: "text",
      hint: "10+ characters; blank keeps the current one",
      info: "Blank leaves sign-in to SSO, or keeps the existing password.",
    },
    {
      key: "disabled",
      label: "disabled",
      formOnly: true,
      only: "edit",
      edit: "checkbox",
      hint: "cannot sign in; past activity stays attributed",
    },
    { key: "status", label: "status", width: "8rem", cell: statusCell },
  ]);

  onMount(() => {
    users.reload();
    teams.reload();
    memberships.reload();
  });
</script>

{#snippet teamsCell(u: UserRow)}
  {@const ms = teamsOf(u)}
  {#if ms.length}
    <span class="chips">
      {#each ms as m (m.team_slug)}
        <Chip
          tone={m.team_role === "admin" ? "accent" : "default"}
          title={m.team_role === "admin" ? TEAM_ROLE_TIP : m.team_name}
          >{m.team_name}{m.team_role === "admin" ? " · admin" : ""}</Chip
        >
      {/each}
    </span>
  {:else}
    <span class="none">—</span>
  {/if}
{/snippet}

{#snippet statusCell(u: UserRow)}
  {#if u.disabled}
    <Badge tone="danger">disabled</Badge>
  {:else if u.has_password}
    <Badge tone="ok">password</Badge>
  {:else}
    <Badge>SSO only</Badge>
  {/if}
{/snippet}

{#snippet rosterEditor(f: { mode: "create" | "edit"; row: UserRow | null })}
  {#if f.row && myTeams.length}
    <div class="roster">
      <p class="rl">{t("teams")}</p>
      {#each myTeams.filter((tm) => tm.slug in roster) as tm (tm.slug)}
        <div class="rrow">
          <span class="rn">{tm.name}</span>
          <Select
            value={roster[tm.slug]}
            options={[
              { value: "member", label: "member" },
              { value: "admin", label: "admin" },
            ]}
            title={TEAM_ROLE_TIP}
            aria-label={`${tm.name} role`}
            onchange={(v) => (roster[tm.slug] = v as "admin" | "member")}
          />
          <Button
            variant="ghost"
            tone="danger"
            square
            icon="cancel"
            title="remove"
            aria-label={`remove from ${tm.name}`}
            onclick={() => delete roster[tm.slug]}
          />
        </div>
      {/each}

      {#if myTeams.some((tm) => !(tm.slug in roster))}
        {@const free = myTeams.filter((tm) => !(tm.slug in roster))}
        <div class="rrow">
          <Select
            value={addTeam}
            options={[
              { value: "", label: `add to a ${t("team")}…` },
              ...free.map((tm) => ({ value: tm.slug, label: tm.name })),
            ]}
            aria-label={`add to ${t("team")}`}
            onchange={(v) => {
              if (v) roster[String(v)] = "member";
              addTeam = "";
            }}
          />
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="bar">
  <input
    placeholder="filter by email or name…"
    aria-label="filter users"
    bind:value={filter}
  />
  <span class="count">{filtered.length} of {users.data.length}</span>
</div>

<CrudTable
  {columns}
  rows={filtered}
  rowKey={(u) => u.id}
  loading={users.loading}
  error={users.error ?? memberships.error}
  emptyTitle={users.data.length
    ? "No users match the filter."
    : "No users yet."}
  emptyDetail={users.data.length
    ? undefined
    : "Run the setup wizard, or add the first one here."}
  canEdit={() => admin}
  canDelete={() => false}
  canCreate={admin}
  addLabel="add user"
  editTitle={(u) => u.email}
  formExtra={rosterEditor}
  onform={openedForm}
  oncreate={(d) =>
    users.mutate(async () => {
      await api.post("/users", {
        email: d.email,
        display_name: d.display_name || undefined,
        password: d.password || undefined,
        role: d.role,
      });
      await memberships.reload();
    })}
  onsave={(row, d) =>
    users.mutate(async () => {
      if (
        row.email === session.me?.email &&
        (d.role !== row.role || Boolean(d.disabled) !== row.disabled)
      )
        throw new Error(
          "that change would lock you out — have another admin make it",
        );
      await api.patch(`/users/${row.id}`, {
        display_name: d.display_name || null,
        role: d.role,
        disabled: Boolean(d.disabled),
        ...(d.password ? { password: String(d.password) } : {}),
      });
      await applyRoster(row);
      await memberships.reload();
    })}
/>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--gap);
    margin-bottom: var(--pad-3);
  }
  .bar input {
    min-width: 16rem;
  }
  .count {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .chips {
    display: flex;
    gap: var(--pad-1);
    flex-wrap: wrap;
  }
  .none {
    color: var(--muted);
  }

  .roster {
    margin-top: var(--pad-3);
    padding-top: var(--pad-3);
    border-top: 1px dashed var(--border);
  }
  .rl {
    margin: 0 0 var(--pad-2);
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .rrow {
    display: flex;
    align-items: center;
    gap: var(--gap);
    margin-bottom: var(--pad-2);
  }
  .rn {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rrow :global(.asel) {
    width: 11rem;
  }
</style>
