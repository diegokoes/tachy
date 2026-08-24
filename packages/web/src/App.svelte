<script lang="ts">
  import { onMount } from "svelte";
  import ChatView from "./lib/ChatView.svelte";
  import LibraryView from "./lib/library/LibraryView.svelte";
  import AdminView from "./lib/admin/AdminView.svelte";
  import SettingsView from "./lib/settings/SettingsView.svelte";
  import IntroSplash from "./lib/IntroSplash.svelte";
  import SetupWizard from "./lib/SetupWizard.svelte";
  import LoginView from "./lib/LoginView.svelte";
  import { session, initSession } from "./lib/session.svelte";
  import { navItems } from "./lib/nav.svelte";
  import { reducedMotion } from "./lib/gsap";
  import { wipeIn } from "./lib/motion";
  import { PATTERNS } from "./lib/ascii-patterns";
  import { themeState as th, loadThemeFromStorage } from "./lib/theme.svelte";
  import { navigate, section, startRouter } from "./lib/router.svelte";
  import { hints, pushScope, startKeys } from "./lib/keys.svelte";
  import { HintRule, Panel, Scrollbar, Tabs } from "./lib/tui";

  const nav = $derived(navItems());

  const view = $derived(section("chat"));

  let wizardSkipped = $state(localStorage.getItem("tachy-skip-wizard") === "1");
  const showWizard = $derived(session.bootstrapped === false && !wizardSkipped);
  const showLogin = $derived(
    session.bootstrapped !== false &&
      !session.me &&
      Boolean(session.config?.passwordLogin || session.config?.sso),
  );

  function skipWizard() {
    wizardSkipped = true;
    localStorage.setItem("tachy-skip-wizard", "1");
  }

  let splash = $state(!reducedMotion());
  let navEl = $state<HTMLElement>();
  let mainEl = $state<HTMLElement>();
  let navRevealed = $state(false);

  $effect(() => {
    if (!navEl || splash || navRevealed) return;
    wipeIn(navEl.querySelectorAll("button"), () => (navRevealed = true));
  });

  // hidden: the tab bar already shows these numbers — repeating them in the
  // hint rule is noise.
  $effect(() => {
    const items = nav;
    return pushScope(
      items.map((n, i) => ({
        key: String(i + 1),
        label: n.label,
        hidden: true,
        run: () => navigate(`/${n.key}`),
      })),
    );
  });

  onMount(() => {
    loadThemeFromStorage();
    initSession();
    const stopRouter = startRouter();
    const stopKeys = startKeys();
    return () => {
      stopRouter();
      stopKeys();
    };
  });
</script>

{#if splash}
  <IntroSplash onDone={() => (splash = false)} />
{/if}

{#if th.patternIdx >= 0}
  <pre class="ascii-bg" style="opacity: {th.patternAlpha}">{PATTERNS[
      th.patternIdx
    ]}</pre>
{/if}

{#if session.loading}
  <!-- background only while the session resolves; the splash covers cold loads -->
{:else if showWizard}
  <SetupWizard onDone={() => {}} onSkip={skipWizard} />
{:else if showLogin}
  <LoginView />
{:else}
  <div class="app">
    <Panel title="tachy" grow>
      <div class="shell">
        <div class="navrow" bind:this={navEl} class:unrevealed={!navRevealed}>
          <Tabs
            items={nav}
            active={view}
            onpick={(k) => navigate(`/${k}`)}
          />
        </div>

        <div class="content">
          <main id="main-content" bind:this={mainEl}>
            {#if view === "library"}
              <LibraryView />
            {:else if view === "admin"}
              <AdminView />
            {:else if view === "settings"}
              <SettingsView />
            {:else}
              <ChatView />
            {/if}
          </main>
          <Scrollbar target={mainEl} controls="main-content" />
        </div>

        <div class="hintrow">
          <HintRule hints={hints()} />
        </div>
      </div>
    </Panel>
  </div>
{/if}

<style>
  .ascii-bg {
    position: fixed;
    inset: 0;
    z-index: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    white-space: pre;
    font: 15px/1.3 monospace;
    color: var(--pattern-ink);
    pointer-events: none;
    user-select: none;
  }

  .app {
    position: relative;
    z-index: 1;
    height: 100vh;
    display: flex;
    padding: var(--pad-4) clamp(0.75rem, 3vw, 2.5rem);
  }

  .app :global(> section) {
    flex: 1;
    max-width: 78rem;
    margin: 0 auto;
    min-width: 0;
  }

  .shell {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    gap: var(--pad-2);
  }

  /* Wiped out until the GSAP reveal takes over (its inline clip-path wins). */
  .navrow.unrevealed :global(button) {
    clip-path: inset(0 100% 0 0);
  }
  .navrow :global(.tab .num) {
    font-size: calc(var(--fs-xs) + 0.09rem);
  }

  .content {
    flex: 1;
    display: flex;
    min-height: 0;
    min-width: 0;
  }

  /* Native bar hidden — the ASCII scrollbar beside it takes over. */
  main {
    flex: 1;
    min-width: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    scrollbar-width: none;
    padding-right: var(--pad-2);
  }
  main::-webkit-scrollbar {
    display: none;
  }

  main > :global(*) {
    flex-shrink: 0;
  }
  main > :global(.chat) {
    flex: 1 1 auto;
    min-height: 0;
  }

  .hintrow {
    flex: none;
    min-height: 1.2rem;
  }
</style>
