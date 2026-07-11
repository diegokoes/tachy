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
  import AsciiScrollbar from "./lib/AsciiScrollbar.svelte";
  import { session, initSession, isCurator } from "./lib/session.svelte";
  import { gsap, reducedMotion } from "./lib/gsap";
  import {
    ANSI16,
    BORDERS,
    BORDER_KEYS,
    PATTERNS,
    PATTERN_LABELS,
    borderPreview,
    patternPreview,
  } from "./lib/ascii-patterns";
  import {
    themeState as th,
    loadThemeFromStorage,
    selectAccent,
    resetAccent,
    setTheme,
    setPattern,
    setPatternAlpha,
    setFontScale,
    setBorder,
  } from "./lib/theme.svelte";

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
        <div class="theme-panel">
          <section class="theme-section">
            <h3>Mode</h3>
            <div class="mode-row">
              <button class:active={th.theme === "dark"} onclick={() => setTheme("dark")}>Dark</button>
              <button class:active={th.theme === "light"} onclick={() => setTheme("light")}>Light</button>
            </div>
          </section>
          <section class="theme-section">
            <h3>Accent color</h3>
            <div class="ansi-grid">
              {#each ANSI16 as c}
                <button
                  class="ansi-swatch"
                  class:active={th.accentColor.toLowerCase() === c.hex}
                  style="background: {c.hex}"
                  title="{c.name} · {c.hex}"
                  aria-label={c.name}
                  onclick={() => selectAccent(c.hex)}
                ></button>
              {/each}
            </div>
            <div class="accent-row">
              <span class="accent-hex">{th.accentColor}</span>
              {#if th.accentCustomized}
                <button class="reset" onclick={resetAccent}>reset</button>
              {/if}
            </div>
          </section>
          <section class="theme-section">
            <h3>Text size</h3>
            <label class="slider-row">
              <span>{Math.round(th.fontScale * 100)}%</span>
              <input type="range" min="0.85" max="1.3" step="0.05" value={th.fontScale}
                oninput={(e) => setFontScale(Number((e.target as HTMLInputElement).value))} />
            </label>
          </section>
          <section class="theme-section wide">
            <h3>Background</h3>
            <div class="pattern-grid">
              <button
                class="pat-card"
                class:active={th.patternIdx === -1}
                onclick={() => setPattern(-1)}
                title="plain"
              >
                <pre class="pat-preview pat-none">NONE</pre>
              </button>
              {#each PATTERNS as _, i}
                <button
                  class="pat-card"
                  class:active={th.patternIdx === i}
                  onclick={() => setPattern(i)}
                  title={PATTERN_LABELS[i]}
                >
                  <pre class="pat-preview">{patternPreview(i)}</pre>
                </button>
              {/each}
            </div>
            <label class="slider-row">
              <span>Intensity</span>
              <input type="range" min="0.1" max="1" step="0.05" value={th.patternAlpha}
                oninput={(e) => setPatternAlpha(Number((e.target as HTMLInputElement).value))}
                disabled={th.patternIdx === -1} />
            </label>
          </section>
          <section class="theme-section wide">
            <h3>Borders</h3>
            <div class="pattern-grid">
              <button
                class="pat-card"
                class:active={th.border === "none"}
                onclick={() => setBorder("none")}
                title="none"
              >
                <pre class="pat-preview border-preview pat-none">NONE</pre>
              </button>
              {#each BORDER_KEYS as k}
                <button
                  class="pat-card"
                  class:active={th.border === k}
                  onclick={() => setBorder(k)}
                  title={k}
                >
                  <pre class="pat-preview border-preview">{borderPreview(k)}</pre>
                </button>
              {/each}
            </div>
          </section>
        </div>
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

  /* Theme panel: card grid across the full column width — three small cards
     up top (Mode / Accent / Text size), wide rows below. */
  .theme-panel {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.25rem;
    align-items: stretch;
  }

  .theme-section {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    padding: 1.25rem 1.5rem 1.4rem;
  }

  .theme-section.wide { grid-column: 1 / -1; }

  @media (max-width: 980px) {
    .theme-panel { grid-template-columns: 1fr; }
  }

  .theme-section h3 {
    margin: 0 0 1rem;
    font-size: 1rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text);
    font-weight: 600;
  }

  .mode-row { display: flex; gap: 0.5rem; }
  .mode-row button.active {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--accent);
  }

  .pattern-grid {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.9rem;
  }

  .pat-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .pat-card:hover { border-color: var(--accent); color: var(--text); }

  .pat-card.active {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--text);
  }

  .pat-preview {
    margin: 0;
    padding: 0;
    font: 9px/1.25 monospace;
    color: var(--muted);
    pointer-events: none;
    user-select: none;
    white-space: pre;
    overflow: hidden;
    width: 156px;
    height: 56px;
  }

  .pat-none {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    letter-spacing: 0.2em;
  }

  .pat-card.active .pat-preview { color: var(--text); }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    color: var(--muted);
    font-size: 0.88rem;
  }

  .slider-row input[type="range"] { accent-color: var(--accent); width: 200px; }

  .border-preview { font-size: 10px; line-height: 1.1; }

  .ansi-grid {
    display: grid;
    grid-template-columns: repeat(8, 28px);
    gap: 7px;
    margin-bottom: 0.75rem;
  }

  .ansi-swatch {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }

  .ansi-swatch.active {
    border-color: var(--text);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .accent-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .accent-hex {
    font-size: 0.85rem;
    color: var(--muted);
  }

  .reset { font-size: 0.8rem; padding: 0.2rem 0.6rem; color: var(--muted); }
</style>
