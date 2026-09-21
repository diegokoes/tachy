<script lang="ts">
  import { onMount } from "svelte";
  import type { TeamRole } from "@tachy/contract";
  import { api } from "../api";
  import { session, isGlobalAdmin, canCurateScope } from "../session.svelte";
  import { roleLabel, roleTip, t } from "../terms";
  import {
    Badge,
    Button,
    Checkbox,
    Chip,
    CrudTable,
    Field,
    FilterBar,
    GroupHead,
    Icon,
    Select,
    type Column,
  } from "../tui";
  import type { UserRow } from "./rows";
  import { sectionHoist } from "./sectionAction.svelte";
  import {
    memberships,
    reloadRoster,
    signIn,
    ssoConfigured,
    system,
    teams,
    users,
  } from "./roster.svelte";

  const ROLE_TIP = $derived(roleTip("app"));
  const TEAM_ROLE_TIP = $derived(roleTip("team"));

  const sso = $derived(ssoConfigured());

  /** The toggle holds a boolean; the API takes the two role words. */
  const roleOf = (d: { role?: unknown }) => (d.role ? "admin" : "member");

  const admin = $derived(isGlobalAdmin());
  /** A team admin manages their own team's roster but not the user records. */
  const myTeams = $derived(
    admin ? teams.data : teams.data.filter((tm) => canCurateScope({ team_slug: tm.slug })),
  );

  let filter = $state("");
  let team = $state("");

  const teamsOf = (u: UserRow) =>
    memberships.data.filter((m) => m.user_id === u.id);

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return users.data.filter(
      (u) =>
        (!q ||
          `${u.email} ${u.display_name ?? ""}`.toLowerCase().includes(q)) &&
        (!team || teamsOf(u).some((m) => m.team_slug === team)),
    );
  });

  /* Membership lives on its own endpoint, so the form edits a copy and the
     save fans the differences out afterwards. */
  let roster = $state<Record<string, TeamRole>>({});
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
      info: "Sign-in identity. Immutable.",
    },
    { key: "display_name", label: "name", width: "12rem", edit: "text" },
    /* A toggle, not a two-option select: the question is whether this person
       is an app admin, and a list of two is a longer way to ask it. The draft
       carries the role string the API wants; `value` and the commit convert. */
    {
      key: "role",
      label: roleLabel("app", "admin"),
      width: "9rem",
      cell: roleCell,
      edit: "checkbox",
      value: (r) => r.role === "admin",
      info: ROLE_TIP,
    },
    { key: "teams", label: t("teams"), cell: teamsCell },
    {
      key: "password",
      label: "password",
      width: "8rem",
      formOnly: true,
      edit: "text",
      info: "Min 10 characters. Blank: SSO only, or keep current.",
    },
    {
      key: "disabled",
      label: "disabled",
      formOnly: true,
      only: "edit",
      edit: "checkbox",
      info: "Blocks sign-in. Activity stays attributed.",
    },
    {
      key: "password_login_allowed",
      label: "password under SSO",
      formOnly: true,
      edit: "checkbox",
      info: "Password sign-in allowed under SSO. For break-glass and load-test accounts.",
    },
    {
      key: "service_account",
      label: "service account",
      formOnly: true,
      edit: "checkbox",
      info: "Non-human. Excluded from engagement figures.",
    },
    { key: "signin", label: "password", width: "7rem", cell: passwordCell },
    { key: "sso", label: "SSO", width: "6rem", cell: ssoCell },
    { key: "state", label: "", width: "7rem", cell: stateCell },
  ]);

  onMount(() => {
    void reloadRoster();
    void system.reload();
  });</script>

{#snippet roleCell(u: UserRow)}
  {#if u.role === "admin"}
    <Badge tone="accent" title={ROLE_TIP}>{roleLabel("app", "admin")}</Badge>
  {:else}
    <span class="none">member</span>
  {/if}
{/snippet}

{#snippet teamsCell(u: UserRow)}
  {@const ms = teamsOf(u)}
  {#if ms.length}
    <span class="chips">
      {#each ms as m (m.team_slug)}
        <Chip
          tone={m.team_role === "admin" ? "accent" : "default"}
          title={m.team_role === "admin" ? TEAM_ROLE_TIP : m.team_name}
          >{m.team_name}{m.team_role === "admin"
            ? ` · ${roleLabel("team", "admin")}`
            : ""}</Chip
        >
      {/each}
    </span>
  {:else}
    <span class="none">-</span>
  {/if}
{/snippet}

<!-- Yes or no, drawn rather than worded: a column of "yes"/"no" reads as text
     to be parsed, where a column of marks reads as a pattern to be scanned. -->
{#snippet mark(on: boolean, why: string)}
  <span class="mark" class:on>
    <Icon name={on ? "yes" : "no"} size="1.05em" weight={7} label={why} />
  </span>
{/snippet}

{#snippet passwordCell(u: UserRow)}
  {@const can = signIn(u, sso).password}
  {@render mark(
    can,
    can
      ? "can sign in with a password"
      : u.has_password
        ? "has a password, but SSO is on and this account is not allowed one"
        : "no password set",
  )}
{/snippet}

{#snippet ssoCell(u: UserRow)}
  {@const can = signIn(u, sso).sso}
  {@render mark(
    can,
    can
      ? "can sign in with SSO"
      : u.service_account
        ? "service account, authenticates with a token"
        : sso === null
          ? "SSO setting not visible to you"
          : "SSO is not configured",
  )}
{/snippet}

<!-- Neither state is the common case, so neither gets a column of its own. -->
{#snippet stateCell(u: UserRow)}
  {#if u.disabled}
    <Badge tone="danger">disabled</Badge>
  {:else if u.service_account}
    <Badge>service</Badge>
  {/if}
{/snippet}

{#snippet rosterEditor(f: { mode: "create" | "edit"; row: UserRow | null })}
  {#if f.row && myTeams.length}
    <div class="roster">
      <GroupHead label={t("teams")} />
      {#each myTeams.filter((tm) => tm.slug in roster) as tm (tm.slug)}
        <div class="rrow">
          <span class="rn">{tm.name}</span>
          <!-- Membership is the row existing at all; the toggle only asks
               whether they also run the team. -->
          <label class="opt" title={TEAM_ROLE_TIP}>
            <Checkbox
              checked={roster[tm.slug] === "admin"}
              ariaLabel={`${tm.name}: ${roleLabel("team", "admin")}`}
              onchange={(on) => (roster[tm.slug] = on ? "admin" : "member")}
            />
            <span class="dim">{roleLabel("team", "admin")}</span>
          </label>
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
        <div class="rrow add">
          {#each free as tm (tm.slug)}
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              onclick={() => (roster[tm.slug] = "member")}>{tm.name}</Button
            >
          {/each}
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="bar">
  <FilterBar
    bind:value={filter}
    shown={filtered.length}
    total={users.data.length}
    placeholder="filter by email or name…"
    label="filter users"
  />
  <Select
    bind:value={team}
    options={teams.data.map((tm) => ({ value: tm.slug, label: tm.name }))}
    placeholder={`any ${t("team")}`}
    clearable
    searchable
    keepOpen
    active={!!team}
    aria-label={`filter by ${t("team")}`}
  />
</div>

<CrudTable
  hoist={sectionHoist("users")}
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
    : "Run setup, or add one."}
  canEdit={() => admin}
  canDelete={() => false}
  canCreate={admin}
  addLabel="add user"
  noun="user"
  editTitle={(u) => u.email}
  formExtra={rosterEditor}
  onform={openedForm}
  oncreate={(d) =>
    users.mutate(async () => {
      await api.post("/users", {
        email: d.email,
        display_name: d.display_name || undefined,
        password: d.password || undefined,
        role: roleOf(d),
        service_account: Boolean(d.service_account),
        password_login_allowed: Boolean(d.password_login_allowed),
      });
      await memberships.reload();
    })}
  onsave={(row, d) =>
    users.mutate(async () => {
      if (
        row.email === session.me?.email &&
        (roleOf(d) !== row.role || Boolean(d.disabled) !== row.disabled)
      )
        throw new Error(
          "would lock you out; another app admin must make this change",
        );
      await api.patch(`/users/${row.id}`, {
        display_name: d.display_name || null,
        role: roleOf(d),
        disabled: Boolean(d.disabled),
        service_account: Boolean(d.service_account),
        password_login_allowed: Boolean(d.password_login_allowed),
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
    gap: var(--pad-3);
  }
  .bar > :global(:first-child) {
    flex: 1;
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
  .opt {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    cursor: pointer;
    white-space: nowrap;
  }
  .dim {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .rrow.add {
    flex-wrap: wrap;
    gap: var(--pad-1);
  }
  .mark {
    color: var(--muted);
  }
  .mark.on {
    color: var(--ok);
  }
</style>
