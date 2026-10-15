<script lang="ts">
  import type { Component } from "svelte";
  import { navigate, segment } from "../shell/router.svelte";
  import { isGlobalAdmin, session, logout } from "../access/session.svelte";
  import { setSubnav, type SubnavItem } from "../shell/subnav.svelte";
  import { Button } from "../tui";
  import { close, rebind } from "./rebind.svelte";
  import RebindModal from "./RebindModal.svelte";
  import Agent from "./Agent.svelte";
  import Credentials from "./Credentials.svelte";
  import Tokens from "./Tokens.svelte";
  import Appearance from "./Appearance.svelte";
  import Fonts from "./Fonts.svelte";
  import Dates from "./Dates.svelte";
  import OrgDefaults from "./OrgDefaults.svelte";
  import Keybinds from "./Keybinds.svelte";
  import Columns from "./Columns.svelte";
  import Group from "./Group.svelte";
  import OwnTokens from "../mcp-servers/OwnTokens.svelte";
  import { agentPrefs } from "./prefs.svelte";
  import { SETTINGS_TABS } from "./tabs";

  type Section = {
    label: string;
    hint?: string;
    view: Component;
    /** Left out while it returns false. */
    shown?: () => boolean;
  };

  /** A tab is a pair of columns of groups, or one view that lays itself out. */
  type Layout = { left: Section[]; right: Section[] } | { view: Component };
  type Tab = SubnavItem & Layout;

  const ORG_DEFAULTS: Section = {
    label: "org defaults",
    hint: "What a person sees until they pick their own.",
    view: OrgDefaults,
  };

  const LAYOUTS: Record<string, Layout> = {
    theme: {
      left: [
        { label: "appearance", view: Appearance },
        { label: "dates", view: Dates },
      ],
      right: [{ label: "fonts", view: Fonts }],
    },
    keybinds: { view: Keybinds },
    agent: {
      left: [
        {
          label: "runtime",
          hint: "Each setting follows your team, then your org, until you pick your own.",
          view: Agent,
        },
      ],
      right: [
        {
          label: "keys",
          hint: "Stored encrypted. A shared key answers until you paste your own.",
          view: Credentials,
        },
        {
          label: "mcp servers",
          view: OwnTokens,
          shown: () => Boolean(agentPrefs.creds?.mcp_servers.length),
        },
        {
          label: "api tokens",
          hint: "For scripts that call the API as you. Shown once, stored as a hash.",
          view: Tokens,
        },
      ],
    },
  };

  /** Admins see the org defaults beside the look they publish from. */
  function layoutOf(key: string): Layout {
    const layout = LAYOUTS[key];
    if (key !== "theme" || "view" in layout) return layout;
    if (!session.me || !isGlobalAdmin()) return layout;
    return { ...layout, right: [...layout.right, ORG_DEFAULTS] };
  }

  const TABS: Tab[] = $derived(
    SETTINGS_TABS.map((tab) => ({ ...tab, ...layoutOf(tab.key) })),
  );

  /**
   * Section URLs from before the tabs survive in bookmarks and history; each
   * lands on the tab that holds its content.
   */
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
    if (seg && seg !== tab.key)
      navigate(`/settings/${tab.key}`, { replace: true });
  });

  $effect(() =>
    setSubnav({
      items: TABS,
      active: tab.key,
      onpick: (k) => navigate(`/settings/${k}`),
      actions: account,
    }),
  );

  // A rebind open on one tab must not outlive the reader leaving it.
  $effect(() => {
    tab;
    close();
  });
</script>

{#snippet account()}
  {#if session.me}
    <span class="who">{session.me.email}</span>
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

{#snippet column(sections: Section[])}
  {#each sections.filter((s) => !s.shown || s.shown()) as section (section.label)}
    {@const View = section.view}
    <Group label={section.label} hint={section.hint}><View /></Group>
  {/each}
{/snippet}

<div class="tab">
  {#if "view" in tab}
    {@const View = tab.view}
    <View />
  {:else}
    <Columns width="30rem">
      {#snippet left()}{@render column(tab.left)}{/snippet}
      {#snippet right()}{@render column(tab.right)}{/snippet}
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
