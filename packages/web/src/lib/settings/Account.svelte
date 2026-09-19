<script lang="ts">
  import { session, logout } from "../session.svelte";
  import { Button } from "../tui";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";
</script>

<Rows>
  <Row label="signed in as">
    <span class="who">{session.me?.email ?? "-"}</span>
  </Row>
  {#if session.me}
    <Row label="session">
      <div>
        <Button onclick={logout}>log out</Button>
      </div>
    </Row>
  {/if}
</Rows>

<style>
  .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }
</style>
