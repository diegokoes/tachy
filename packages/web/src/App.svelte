<script lang="ts">
  import { onMount } from "svelte";
  import ChatView from "./lib/ChatView.svelte";
  import KnowledgeView from "./lib/KnowledgeView.svelte";
  import ReferenceView from "./lib/ReferenceView.svelte";
  import AdminView from "./lib/admin/AdminView.svelte";
  import MySettings from "./lib/MySettings.svelte";
  import IntroSplash from "./lib/IntroSplash.svelte";
  import SetupWizard from "./lib/SetupWizard.svelte";
  import LoginView from "./lib/LoginView.svelte";
  import ThemeView from "./lib/ThemeView.svelte";
  import AsciiScrollbar from "./lib/AsciiScrollbar.svelte";
  import { session, initSession, isCurator } from "./lib/session.svelte";
  import { gsap, reducedMotion } from "./lib/gsap";
  import { BORDERS, PATTERNS } from "./lib/ascii-patterns";
  import { themeState as th, loadThemeFromStorage } from "./lib/theme.svelte";

  type View = "chat" | "knowledge" | "reference" | "admin" | "me" | "theme";
  const NAV_ALL: { key: View; label: string }[] = [
    { key: "chat", label: "Tachy" },
    { key: "knowledge", label: "Knowledge" },
    { key: "reference", label: "Reference" },
    { key: "admin", label: "Admin" },
    { key: "me", label: "Settings" },
    { key: "theme", label: "Theme" },
  ];

  const nav = $derived(!isCurator() && session.me ? NAV_ALL.filter((n) => n.key !== "admin") : NAV_ALL);

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

  let view = $state<View>("knowledge");
  let splash = $state(!reducedMotion());
  let navEl = $state<HTMLElement>();
  let mainEl = $state<HTMLElement>();
  let navRevealed = $state(false);

  function revealNav() {
    if (!navEl) return;
    if (reducedMotion()) {
      navRevealed = true;
      return;
    }
    const buttons = navEl.querySelectorAll("button");
    gsap.fromTo(
      buttons,
      { clipPath: "inset(0 100% 0 0)" },
      {
        clipPath: "inset(0 0% 0 0)",
        duration: 0.3,
        ease: "power3.out",
        stagger: 0.14,
        onStart: () => (navRevealed = true),
        onComplete: () => gsap.set(buttons, { clearProps: "clipPath" }),
      },
    );
  }

  $effect(() => {
    if (navEl && !splash && !navRevealed) revealNav();
  });

  onMount(() => {
    loadThemeFromStorage();
    initSession();
  });
</script>

{#if splash}
  <IntroSplash onDone={() => (splash = false)} />
{/if}

{#if th.patternIdx >= 0}
  <pre class="ascii-bg" style="opacity: {th.patternAlpha}">{PATTERNS[th.patternIdx]}</pre>
{/if}

{#if session.loading}
  <!-- background only while the session resolves; the splash covers this on cold loads -->
{:else if showWizard}
  <SetupWizard onDone={() => {}} onSkip={skipWizard} />
{:else if showLogin}
  <LoginView />
{:else}
<div class="app">
  <aside>
    <nav bind:this={navEl} class:unrevealed={!navRevealed}>
      {#each nav as n}
        <button class:active={view === n.key} onclick={() => (view = n.key)}>{n.label}</button>
      {/each}
    </nav>
  </aside>

  <div class="main">
    <div class="frame" class:framed={th.border !== "none"}>
      {#if th.border !== "none"}
        {@const b = BORDERS[th.border]}
        <pre class="edge v left" aria-hidden="true">{(b.left + "\n").repeat(400)}</pre>
        <pre class="edge v right" aria-hidden="true">{(b.right + "\n").repeat(400)}</pre>
        <pre class="edge h top" aria-hidden="true">{b.top.repeat(600)}</pre>
        <pre class="edge h bottom" aria-hidden="true">{b.bottom.repeat(600)}</pre>
      {/if}
      <main id="main-content" bind:this={mainEl}>
      {#if view === "knowledge"}
        <KnowledgeView />
      {:else if view === "reference"}
        <ReferenceView />
      {:else if view === "admin"}
        <AdminView />
      {:else if view === "me"}
        <MySettings />
      {:else if view === "theme"}
        <ThemeView />
      {:else}
        <ChatView />
      {/if}
      </main>
      <AsciiScrollbar target={mainEl} controls="main-content" />
    </div>
  </div>
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
    height: 100vh;
    position: relative;
    z-index: 1;
  }

  aside {
    position: fixed;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    background: var(--aside-bg);

    border: 1px solid var(--border);
    border-left: none;
    border-right: 6px solid var(--aside-edge-hi);
    border-bottom: 6px solid var(--aside-edge-hi);
    border-radius: 0 7px 7px 0;
    padding: 0.6rem 0.85rem 0.7rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    box-shadow:
      inset -3px -3px 0 var(--aside-edge-lo),
      7px 8px 18px -6px var(--aside-drop);
  }

  nav { display: flex; flex-direction: column; gap: 0.15rem; }

  /* Pre-reveal state: fully wiped out until the GSAP tween takes over
     (its inline clip-path overrides this the moment it starts). */
  nav.unrevealed button { clip-path: inset(0 100% 0 0); }

  nav button {
    text-align: left;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
    padding: 0.4rem 0.8rem;
    white-space: nowrap;
    font-size: 0.95rem;
  }

  nav button:hover { color: var(--text); border-color: transparent; }

  nav button.active {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Content column centered on the viewport; symmetric padding clears the
     floating nav on the left and mirrors it on the right on wide screens. */
  .main {
    height: 100vh;
    display: flex;
    justify-content: center;
    padding: 0 clamp(100px, 7vw, 160px);
  }

  /* The frame ALWAYS reserves the border chrome (margin + padding), whether a
     border is active or not, so toggling borders never shifts the content.
     The panel background keeps the ascii pattern from bleeding through. */
  .frame {
    flex: 1;
    max-width: 1280px;
    min-width: 0;
    position: relative;
    display: flex;
    margin: 0.75rem 0;
    padding: 1.4rem 1.6rem;
    background: var(--panel);
    border-radius: 6px;
  }

  /* Native bar hidden — the ASCII scrollbar beside it takes over. */
  main {
    flex: 1;
    min-width: 0;
    padding: 0.75rem 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    background: transparent;
    scrollbar-width: none;
    margin-right: 0.35rem;
  }
  main::-webkit-scrollbar {
    display: none;
  }

  /* Frame edges: overflow-clipped character repeats, no measurement needed.
     Side columns run full height; top/bottom rows fill between them. The
     frame's padding keeps main's scrollport (and its scrollbar) INSIDE the
     edges, so scrolled content never slides under them. */
  .edge {
    position: absolute;
    margin: 0;
    padding: 0;
    overflow: hidden;
    white-space: pre;
    font: 14px/14px monospace;
    color: var(--muted);
    pointer-events: none;
    user-select: none;
  }
  .edge.v { top: 0; bottom: 0; width: 1ch; }
  .edge.left { left: 0; }
  .edge.right { right: 0; }
  .edge.h { left: 1ch; right: 1ch; height: 14px; }
  .edge.top { top: 0; }
  .edge.bottom { bottom: 0; }

  main > :global(*) { flex-shrink: 0; }
  main > :global(.chat) { flex: 1 1 auto; min-height: 0; }

  @media (max-width: 900px) {
    .main { padding: 0 0.9rem 0 118px; }
  }
</style>
