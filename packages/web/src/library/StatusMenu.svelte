<script lang="ts">
  import { Lamp, Menu } from "../tui";
  import { statusItems, statusLamp } from "./status";

  let {
    status,
    statuses,
    searched,
    onpick,
  }: {
    status: string;
    /** What it can be moved to, in the order offered. */
    statuses: readonly string[];
    /** The statuses search returns, said beside each row. */
    searched: readonly string[];
    /** Makes the status a menu; without it the lamp is only read. */
    onpick?: (status: string) => void;
  } = $props();
</script>

{#if onpick}
  <Menu label="status" items={statusItems(statuses, status, searched)} {onpick}>
    {#snippet face()}<Lamp lamp={statusLamp(status)} word={status} />{/snippet}
  </Menu>
{:else}
  <Lamp lamp={statusLamp(status)} word={status} />
{/if}
