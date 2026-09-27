<script lang="ts">
  import type { Component } from "svelte";
  import { navigate, segment } from "../router.svelte";
  import { session, logout } from "../session.svelte";
  import { setSubnav, type SubnavItem } from "../subnav.svelte";
  import { Button, tip } from "../tui";
  import { close, rebind } from "./rebind.svelte";
  import RebindModal from "./RebindModal.svelte";
  import Agent from "./Agent.svelte";
  import Credentials from "./Credentials.svelte";
  import Appearance from "./Appearance.svelte";
  import Fonts from "./Fonts.svelte";
  import Keybinds from "./Keybinds.svelte";
  import Columns from "./Columns.svelte";
  import Group from "./Group.svelte";

  type Section = { label: string; hint?: string; view: Component };

  /** A tab is a pair of groups, one per column, or one view that lays itself
   *  out. */
  type Tab = SubnavItem &
    ({ left: Section; right: Section } | { view: Component });

  const TABS: Tab[] = [
    {
      key: "theme",
      label: "theme",
      icon: "theme",
      left: { label: "appearance", view: Appearance },
      right: { label: "fonts", view: Fonts },
    },
    {
      key: "keybinds",
      label: "keybinds",
      icon: "keybinds",
      view: Keybinds,
    },
    {
      key: "agent",
      label: "agent",
      icon: "agent",
      left: { label: "model", view: Agent },
      right: { label: "keys", view: Credentials },
    },
  ];

  /** Section URLs from before the tabs survive in bookmarks and history; each
   *  lands on the tab that holds its content. */
  const MOVED: Record<string, string> = {
    ui: "theme",
    appearance: "theme",
    fonts: "theme",
    "section-keys": "keybinds",
    "subnav-keys": "keybinds",
    vim: "keybinds",
    reference: "keybinds",
    account: "agent",
    keys: "agent",
  };

  const seg = $derived(segment(1));
  const tab = $derived(
    TABS.find((t) => t.key === (seg && (MOVED[seg] ?? seg))) ?? TABS[0],
  );

  $effect(() => {
    if (seg && seg !== tab.key) navigate(`/settings/${tab.key}`, { replace: true });
  });

  $effect(() =>
    setSubnav({
      items: TABS,
      active: tab.key,
      onpick: (k) => navigate(`/settings/${k}`),
      actions: account,
    }),
  );

  /* A rebind open on one tab must not outlive the reader leaving it. */
  $effect(() => {
    tab;
    close();
  });
</script>

{#snippet account()}
  {#if session.me}
    <span class="who" use:tip={`signed in as ${session.me.email}`}>{session.me.email}</span>
    <Button
      variant="ghost"
      square
      icon="logout"
      title="log out"
      aria-label="log out"
      onclick={logout}
    />
  {/if}
{/snippet}

{#snippet section(s: Section)}
  {@const View = s.view}
  <Group label={s.label} hint={s.hint}><View /></Group>
{/snippet}

<div class="tab">
  {#if "view" in tab}
    {@const View = tab.view}
    <View />
  {:else}
    <Columns width="30rem">
      {#snippet left()}{@render section(tab.left)}{/snippet}
      {#snippet right()}{@render section(tab.right)}{/snippet}
    </Columns>
  {/if}
</div>

{#if rebind.target}
  {#key rebind.target}<RebindModal target={rebind.target} />{/key}
{/if}

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: calc(var(--pad-4) * 1.5);
    padding: 0 var(--view-pad-x) var(--view-pad-y);
    min-width: 0;
  }
  .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
