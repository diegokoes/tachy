<script lang="ts">
  import { navigate, segment } from "../router.svelte";
  import { session, logout } from "../session.svelte";
  import { Button, Tabs } from "../tui";
  import AgentTab from "./AgentTab.svelte";
  import KeysTab from "./KeysTab.svelte";
  import ThemeTab from "./ThemeTab.svelte";

  const TABS = [
    { key: "agent", label: "agent" },
    { key: "keys", label: "keys" },
    { key: "theme", label: "theme" },
  ];

  const tab = $derived(segment(1) ?? "agent");
</script>

<div class="head">
  <Tabs
    items={TABS}
    active={tab}
    hotkeys="shift"
    onpick={(k) => navigate(`/settings/${k}`)}
  >
    {#snippet right()}
      <span class="who">{session.me?.email ?? ""}</span>
      {#if session.me}
        <Button variant="ghost" size="sm" onclick={logout}>log out</Button>
      {/if}
    {/snippet}
  </Tabs>
</div>

{#if tab === "keys"}
  <KeysTab />
{:else if tab === "theme"}
  <ThemeTab />
{:else}
  <AgentTab />
{/if}

<style>
  .head {
    margin-bottom: var(--pad-4);
  }
  .who {
    color: var(--muted);
  }
</style>
