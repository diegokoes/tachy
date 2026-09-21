<script lang="ts">
  import { onMount } from "svelte";
  import { roleLabel } from "../terms";
  import { Badge, DataTable, Icon, Note, type Column } from "../tui";
  import { fmtDate } from "../dates";
  import {
    reloadRoster,
    signIn,
    ssoConfigured,
    system,
    users,
    type UserRow,
  } from "./roster.svelte";

  const sso = $derived(ssoConfigured());

  /* Who can change anything, on one screen. The list is short by design, and
     that is the point of showing it apart from the roster: an app admin that
     nobody meant to create is invisible among two hundred members. */
  const rows = $derived(
    users.data
      .filter((u) => u.role === "admin")
      .sort((a, b) => a.email.localeCompare(b.email)),
  );

  /* Two ways to lose the keys: nobody holds them, or the only person who does
     cannot sign in. Both are worth saying out loud. */
  const live = $derived(
    rows.filter((u) => !u.disabled && (signIn(u, sso).password || signIn(u, sso).sso)),
  );

  const columns: Column<UserRow>[] = $derived([
    { key: "email", label: "user", width: "20rem" },
    { key: "display_name", label: "name", width: "14rem" },
    { key: "signin", label: "can sign in", width: "9rem", cell: signInCell },
    {
      key: "created_at",
      label: "since",
      width: "9rem",
      value: (u) => fmtDate(u.created_at),
    },
    { key: "state", label: "", width: "7rem", cell: stateCell },
  ]);

  onMount(reloadRoster);
  onMount(() => void system.reload());
</script>

{#snippet signInCell(u: UserRow)}
  {@const how = signIn(u, sso)}
  {@const on = !u.disabled && (how.password || how.sso)}
  <span class="mark" class:on>
    <Icon
      name={on ? "yes" : "no"}
      size="1.05em"
      weight={7}
      label={on
        ? [how.password ? "password" : "", how.sso ? "SSO" : ""]
            .filter(Boolean)
            .join(" · ")
        : u.disabled
          ? "disabled"
          : "no way in"}
    />
  </span>
{/snippet}

{#snippet stateCell(u: UserRow)}
  {#if u.disabled}
    <Badge tone="danger">disabled</Badge>
  {:else if u.service_account}
    <Badge>service</Badge>
  {/if}
{/snippet}

{#if !live.length && rows.length}
  <Note tone="danger">
    No {roleLabel("app", "admin")} can currently sign in. Nobody can change
    settings, users or connections until one can.
  </Note>
{/if}

<DataTable
  {columns}
  {rows}
  rowKey={(u) => u.id}
  loading={users.loading}
  error={users.error}
  emptyTitle={`No ${roleLabel("app", "admin")} yet.`}
  emptyDetail="Nobody can change settings, users or connections."
/>

<style>
  .mark {
    color: var(--muted);
  }
  .mark.on {
    color: var(--ok);
  }
</style>
