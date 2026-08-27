<script lang="ts">
  import { navigate, segment } from "../router.svelte";
  import { session, logout } from "../session.svelte";
  import { Button } from "../tui";
  import { setSubnav } from "../subnav.svelte";
  import AgentTab from "./AgentTab.svelte";
  import UiTab from "./UiTab.svelte";
  import KeybindsTab from "./KeybindsTab.svelte";

  const TABS = [
    { key: "agent", label: "agent" },
    { key: "ui", label: "ui" },
    { key: "keybinds", label: "keybinds" },
  ];

  const raw = $derived(segment(1) ?? "agent");
  // "theme" was this tab's name until the UI rework; keep old links working.
  const tab = $derived(raw === "theme" ? "ui" : raw);

  $effect(() =>
    setSubnav({
      items: TABS,
      active: tab,
      onpick: (k) => navigate(`/settings/${k}`),
      actions: account,
    }),
  );
</script>

<!-- Rendered by App into the carved row beside the subnav, not here. Who you
     are signed in as is a Settings concern, so it stays owned by this view
     rather than becoming global chrome. -->
{#snippet account()}
  <span class="who">{session.me?.email ?? ""}</span>
  {#if session.me}
    <Button size="sm" onclick={logout}>log out</Button>
  {/if}
{/snippet}

{#if tab === "ui"}
  <UiTab />
{:else if tab === "keybinds"}
  <KeybindsTab />
{:else}
  <AgentTab />
{/if}

<style>
  /* Truncates rather than pushing the log-out button into the recess when the
     window is narrow and the address is long. */
  .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
