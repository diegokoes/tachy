<script lang="ts">
  import { session, type Me } from "../access/session.svelte";
  import { EMPTY } from "../tui";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  const VIA: Record<Me["via"], string> = {
    password: "password",
    sso: "single sign-on",
    open: "open mode, no sign-in",
  };

  const me = $derived(session.me);
  const teams = $derived(me?.teams?.map((t) => t.team_slug).join(", "));
</script>

{#if me}
  <Rows>
    <Row label="email"><span class="val">{me.email ?? EMPTY}</span></Row>
    <Row label="name"><span class="val">{me.name ?? EMPTY}</span></Row>
    <Row label="role"><span class="val">{me.role}</span></Row>
    <Row label="teams"><span class="val">{teams || EMPTY}</span></Row>
    <Row label="signed in with"><span class="val">{VIA[me.via]}</span></Row>
  </Rows>
{/if}

<style>
  .val {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--fs-sm);
  }
</style>
