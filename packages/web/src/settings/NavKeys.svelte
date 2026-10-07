<script lang="ts">
  import { navItems } from "../shell/nav";
  import {
    ACTIONS,
    keymap,
    resetKeys,
    type Action,
  } from "../keys/bindings.svelte";
  import { Button } from "../tui";
  import { SUBNAV_SLOTS } from "./rebind.svelte";
  import KeyRow from "./KeyRow.svelte";

  const actions = Object.keys(ACTIONS) as Action[];

  const customized = $derived(
    Object.keys(keymap.nav).length + Object.keys(keymap.subnav).length > 0,
  );
</script>

{#each navItems() as n (n.key)}
  <KeyRow label={n.label} target={{ kind: "nav", item: n.key }} />
{/each}
{#each actions as action (action)}
  <KeyRow
    label={ACTIONS[action].label}
    target={{ kind: "action", item: action }}
  />
{/each}
{#each { length: SUBNAV_SLOTS } as _, i}
  <KeyRow label="sub tab {i + 1}" target={{ kind: "subnav", slot: i }} />
{/each}

{#if customized}
  <div class="reset-all">
    <Button variant="ghost" size="sm" icon="reset" onclick={resetKeys}
      >reset all keys</Button
    >
  </div>
{/if}

<style>
  .reset-all {
    margin-top: var(--pad-2);
  }
</style>
