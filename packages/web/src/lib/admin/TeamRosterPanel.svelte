<script lang="ts">
  import { onMount } from "svelte";
  import { roleLabel, t } from "../terms";
  import { Badge, Chip, DataTable, Note, type Column } from "../tui";
  import { showSection } from "./overview";
  import {
    memberships,
    membersOf,
    reloadRoster,
    teams,
    users,
    type Team,
  } from "./roster.svelte";

  /** Memberships carry only a user id, so the names come from the user list. */
  const nameOf = (id: string) => {
    const u = users.data.find((x) => x.id === id);
    return u ? (u.display_name ?? u.email) : id;
  };

  /* A read of who is where, not another place to edit it. Membership is
     changed on the person, in the users list, because that is the record that
     carries the rest of their account. */
  const rows = $derived(
    [...teams.data].sort((a, b) => a.name.localeCompare(b.name)),
  );

  const admins = (tm: Team) =>
    membersOf(tm.slug, memberships.data).filter((m) => m.team_role === "admin");
  const all = (tm: Team) => membersOf(tm.slug, memberships.data);

  const headless = $derived(rows.filter((tm) => !admins(tm).length));

  const columns: Column<Team>[] = $derived([
    { key: "name", label: t("team"), width: "14rem" },
    { key: "admins", label: roleLabel("team", "admin"), cell: adminsCell },
    {
      key: "members",
      label: "members",
      width: "7rem",
      align: "end",
      value: (tm) => all(tm).length,
    },
  ]);

  onMount(reloadRoster);
</script>

{#snippet adminsCell(tm: Team)}
  {@const list = admins(tm)}
  {#if list.length}
    <span class="chips">
      {#each list as m (m.user_id)}
        <Chip tone="accent" title={nameOf(m.user_id)}>{nameOf(m.user_id)}</Chip>
      {/each}
    </span>
  {:else}
    <Badge tone="warn">nobody</Badge>
  {/if}
{/snippet}

{#if headless.length}
  <Note tone="warn">
    {headless.length}
    {headless.length === 1 ? t("team") : t("teams")} with no
    {roleLabel("team", "admin")}: nobody there can curate.
    <button class="link" onclick={() => showSection("users")}>open users</button>
  </Note>
{/if}

<DataTable
  {columns}
  {rows}
  rowKey={(tm) => tm.slug}
  loading={teams.loading}
  error={teams.error ?? memberships.error}
  emptyTitle={`No ${t("teams")} yet.`}
  emptyDetail={`Add them under structure.`}
/>

<style>
  .chips {
    display: flex;
    gap: var(--pad-1);
    flex-wrap: wrap;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
