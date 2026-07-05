<script lang="ts">
  import { onMount } from "svelte";
  import ChatView from "./lib/ChatView.svelte";
  import KnowledgeView from "./lib/KnowledgeView.svelte";
  import ReferenceView from "./lib/ReferenceView.svelte";
  import AdminView from "./lib/AdminView.svelte";
  import IntroSplash from "./lib/IntroSplash.svelte";
  import SetupWizard from "./lib/SetupWizard.svelte";
  import LoginView from "./lib/LoginView.svelte";
  import { session, initSession, logout } from "./lib/session.svelte";
  import { gsap, reducedMotion } from "./lib/gsap";

  type View = "chat" | "knowledge" | "reference" | "admin" | "theme";
  const NAV_ALL: { key: View; label: string }[] = [
    { key: "chat", label: "Tachy" },
    { key: "knowledge", label: "Knowledge" },
    { key: "reference", label: "Reference" },
    { key: "admin", label: "Admin" },
    { key: "theme", label: "Theme" },
  ];
  // Members don't get the Admin view (the API enforces this server-side too).
  const nav = $derived(session.me?.role === "member" ? NAV_ALL.filter((n) => n.key !== "admin") : NAV_ALL);

  // Wizard shows on un-bootstrapped instances unless deliberately skipped
  // (open-mode localhost dev keeps working without setup).
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

  type Theme = "dark" | "light";
  const ACCENT_DEFAULTS: Record<Theme, string> = { dark: "#6ea8fe", light: "#31589e" };

  let view = $state<View>("knowledge");
  // Boot ident on every full page load; skipped for reduced-motion users.
  let splash = $state(!reducedMotion());
  let navEl = $state<HTMLElement>();
  // Entries start CSS-hidden (no first-paint flash) and wipe in one after
  // another, top to bottom; the class comes off once the tween owns the styles.
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

  // The app shell mounts late (after session load / wizard / login), so the
  // nav reveal fires when its element first exists, not on splash completion.
  $effect(() => {
    if (navEl && !splash && !navRevealed) revealNav();
  });
  let theme = $state<Theme>("dark");
  let patternIdx = $state(0); // -1 = plain background
  let patternAlpha = $state(0.35);
  let accentColor = $state(ACCENT_DEFAULTS.dark);
  let accentCustomized = $state(false);
  let fontScale = $state(1);
  let border = $state<BorderKey>("none");

  // ASCII frame around the content column. Left/right columns run full height;
  // top/bottom rows fill between them (all four are overflow-clipped repeats,
  // so no size measurement is needed).
  type BorderKey = "none" | "tilde" | "blocks" | "hash";
  const BORDERS: Record<Exclude<BorderKey, "none">, { top: string; bottom: string; left: string; right: string }> = {
    tilde: { top: "~", bottom: "~", left: "~", right: "~" },
    blocks: { top: "▀", bottom: "▄", left: "▐", right: "▌" },
    hash: { top: "#", bottom: "#", left: "#", right: "#" },
  };
  const BORDER_KEYS = Object.keys(BORDERS) as Exclude<BorderKey, "none">[];

  function borderPreview(k: Exclude<BorderKey, "none">): string {
    const b = BORDERS[k];
    const w = 24;
    const top = b.left + b.top.repeat(w) + b.right;
    const mid = b.left + " ".repeat(w) + b.right;
    return [top, mid, mid, mid, b.left + b.bottom.repeat(w) + b.right].join("\n");
  }

  function setBorder(k: BorderKey) {
    border = k;
    localStorage.setItem("tachy-border", k);
  }

  // Accent is restricted to the ANSI 16 palette (VS Code terminal values).
  const ANSI16: { name: string; hex: string }[] = [
    { name: "black", hex: "#000000" },
    { name: "red", hex: "#cd3131" },
    { name: "green", hex: "#0dbc79" },
    { name: "yellow", hex: "#e5e510" },
    { name: "blue", hex: "#2472c8" },
    { name: "magenta", hex: "#bc3fbc" },
    { name: "cyan", hex: "#11a8cd" },
    { name: "white", hex: "#e5e5e5" },
    { name: "bright black", hex: "#666666" },
    { name: "bright red", hex: "#f14c4c" },
    { name: "bright green", hex: "#23d18b" },
    { name: "bright yellow", hex: "#f5f543" },
    { name: "bright blue", hex: "#3b8eea" },
    { name: "bright magenta", hex: "#d670d6" },
    { name: "bright cyan", hex: "#29b8db" },
    { name: "bright white", hex: "#ffffff" },
  ];

  const PATTERN_LABELS = ["brackets", "rope", "slashes", "bricks", "stars"];

  // Preview from the first content-bearing lines, windowed to where the
  // content starts (sparse patterns like the starfield begin with blanks).
  function patternPreview(idx: number): string {
    const lines = PATTERNS[idx].split("\n").filter((l) => l.trim() !== "").slice(0, 5);
    const start = Math.min(...lines.map((l) => l.search(/\S/)).filter((n) => n >= 0));
    return lines.map((l) => l.slice(start, start + 26)).join("\n");
  }

  // ── ASCII background generation ─────────────────────────────────────────
  // Each row is a single repeating unit. makeBg tiles it to fill large screens.
  function makeBg(rows: string[], vRep = 60): string {
    const wide = rows.map(u => u.repeat(Math.ceil(650 / u.length) + 2));
    return (wide.join("\n") + "\n").repeat(vRep);
  }

  const P0 = makeBg([" |___  |", "    _|_|", "_  | |__", "_|_|    "]); // brackets
  const P1 = makeBg(["  |  ", "`.__.' _.'", ',-"  ,-""-', "  |  "]); // rope
  const P2 = makeBg(["   /   __/  ", "__   \\__/  \\", "  \\__/  \\   ", "__/     /   "]); // slashes
  const P3 = makeBg(["__|__|   ", " __|__|  ", "|   __|__", "|__|   __"]); // bricks

  // Starfield — one hand-drawn tile. Lines are padded to a common width so all
  // rows repeat with the same period and multi-line glyphs stay aligned.
  const STAR_LINES = [
    "                        .",
    "  .     '                           '                   **",
    " ",
    " ",
    "                         *                                                                    *",
    "                                         |                   ''",
    "                                        -o-",
    "                                         |",
    "        .                                      .                                          *",
    " ",
    "              +                 '                                |",
    "                             .:'                                -+-",
    "                         _.::'  +             .                  |",
    "                        (_.'                          .                                                         +",
    "                                                                                            +",
    "                         +                 +    ..",
    "       o                                                                      +",
    "                                               .                                        .            o",
    "                         \\                o                                                           o",
    " .                        \\                                                             .                  +",
    "                           *                              +",
    "                            o                           /     .                 .                       *",
    "                                                       /        .           +",
    "             .                                        *       '",
    "                     o",
    "                                                   .                     o                                          '",
    "                                                                                                                   '",
    "                                 .                    o                           |                    +",
    "                                                                                --o--",
    "                                                              .                   |",
    "                       .+",
    " ",
    "                       o                                 .        *                                .   '          . '",
    "                         +",
    "  _|_           .         '                                                                                        '",
    "   |                                o                                             '",
    " ",
    "                                                                                               '     .",
    "           o                                                                                        _|_",
    "              o                                                                                   +  |",
    "                    .",
    "                      .",
    " ",
    "           '",
    "                                +",
    "                                                                                                                   |",
    "                                o                                                                                --o--",
    "                                                               .                                               .   |",
    "                               .                 '",
    " ",
  ];
  const starWidth = Math.max(...STAR_LINES.map((l) => l.length));
  const P4 = makeBg(STAR_LINES.map((l) => l.padEnd(starWidth)), 6);

  const PATTERNS: string[] = [P0, P1, P2, P3, P4];

  function setPattern(idx: number) {
    patternIdx = idx;
    localStorage.setItem("tachy-pattern", String(idx));
  }

  function setPatternAlpha(e: Event) {
    patternAlpha = Number((e.target as HTMLInputElement).value);
    localStorage.setItem("tachy-pattern-alpha", String(patternAlpha));
  }

  function applyAccent(v: string) {
    accentColor = v;
    document.documentElement.style.setProperty("--accent", v);
  }

  function selectAccent(hex: string) {
    accentCustomized = true;
    applyAccent(hex);
    localStorage.setItem("tachy-accent", hex);
  }

  function resetAccent() {
    accentCustomized = false;
    localStorage.removeItem("tachy-accent");
    applyAccent(ACCENT_DEFAULTS[theme]);
  }

  function setTheme(t: Theme) {
    theme = t;
    document.documentElement.dataset.theme = t;
    localStorage.setItem("tachy-theme", t);
    // A non-customized accent follows the theme so contrast stays sane.
    if (!accentCustomized) applyAccent(ACCENT_DEFAULTS[t]);
  }

  function setFontScale(e: Event) {
    fontScale = Number((e.target as HTMLInputElement).value);
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
    localStorage.setItem("tachy-font-scale", String(fontScale));
  }

  onMount(() => {
    const savedTheme = localStorage.getItem("tachy-theme") as Theme | null;
    if (savedTheme === "light" || savedTheme === "dark") {
      theme = savedTheme;
      document.documentElement.dataset.theme = savedTheme;
    }
    const savedPattern = localStorage.getItem("tachy-pattern");
    if (savedPattern !== null) patternIdx = Number(savedPattern);
    const savedAlpha = localStorage.getItem("tachy-pattern-alpha");
    if (savedAlpha !== null) patternAlpha = Number(savedAlpha);
    const savedAccent = localStorage.getItem("tachy-accent");
    if (savedAccent) {
      accentCustomized = true;
      applyAccent(savedAccent);
    } else {
      applyAccent(ACCENT_DEFAULTS[theme]);
    }
    const savedScale = localStorage.getItem("tachy-font-scale");
    if (savedScale) {
      fontScale = Number(savedScale);
      document.documentElement.style.setProperty("--font-scale", savedScale);
    }
    const savedBorder = localStorage.getItem("tachy-border");
    if (savedBorder === "none" || (savedBorder && savedBorder in BORDERS)) border = savedBorder as BorderKey;
    initSession();
  });
</script>

{#if splash}
  <IntroSplash onDone={() => (splash = false)} />
{/if}

{#if patternIdx >= 0}
  <pre class="ascii-bg" style="opacity: {patternAlpha}">{PATTERNS[patternIdx]}</pre>
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
    {#if session.me && session.me.via !== "open"}
      <button class="signout" title={session.me.email ?? undefined} onclick={logout}>sign out</button>
    {/if}
  </aside>

  <div class="main">
    <div class="frame" class:framed={border !== "none"}>
      {#if border !== "none"}
        {@const b = BORDERS[border]}
        <pre class="edge v left" aria-hidden="true">{(b.left + "\n").repeat(400)}</pre>
        <pre class="edge v right" aria-hidden="true">{(b.right + "\n").repeat(400)}</pre>
        <pre class="edge h top" aria-hidden="true">{b.top.repeat(600)}</pre>
        <pre class="edge h bottom" aria-hidden="true">{b.bottom.repeat(600)}</pre>
      {/if}
      <main>
      {#if view === "knowledge"}
        <KnowledgeView />
      {:else if view === "reference"}
        <ReferenceView />
      {:else if view === "admin"}
        <AdminView />
      {:else if view === "theme"}
        <div class="theme-panel">
          <section class="theme-section">
            <h3>Mode</h3>
            <div class="mode-row">
              <button class:active={theme === "dark"} onclick={() => setTheme("dark")}>Dark</button>
              <button class:active={theme === "light"} onclick={() => setTheme("light")}>Light</button>
            </div>
          </section>
          <section class="theme-section">
            <h3>Accent color</h3>
            <div class="ansi-grid">
              {#each ANSI16 as c}
                <button
                  class="ansi-swatch"
                  class:active={accentColor.toLowerCase() === c.hex}
                  style="background: {c.hex}"
                  title="{c.name} · {c.hex}"
                  aria-label={c.name}
                  onclick={() => selectAccent(c.hex)}
                ></button>
              {/each}
            </div>
            <div class="accent-row">
              <span class="accent-hex">{accentColor}</span>
              {#if accentCustomized}
                <button class="reset" onclick={resetAccent}>reset</button>
              {/if}
            </div>
          </section>
          <section class="theme-section">
            <h3>Text size</h3>
            <label class="slider-row">
              <span>{Math.round(fontScale * 100)}%</span>
              <input type="range" min="0.85" max="1.3" step="0.05" value={fontScale} oninput={setFontScale} />
            </label>
          </section>
          <section class="theme-section wide">
            <h3>Background</h3>
            <div class="pattern-grid">
              <button
                class="pat-card"
                class:active={patternIdx === -1}
                onclick={() => setPattern(-1)}
                title="plain"
              >
                <pre class="pat-preview pat-none">NONE</pre>
              </button>
              {#each PATTERNS as _, i}
                <button
                  class="pat-card"
                  class:active={patternIdx === i}
                  onclick={() => setPattern(i)}
                  title={PATTERN_LABELS[i]}
                >
                  <pre class="pat-preview">{patternPreview(i)}</pre>
                </button>
              {/each}
            </div>
            <label class="slider-row">
              <span>Intensity</span>
              <input type="range" min="0.1" max="1" step="0.05" value={patternAlpha}
                oninput={setPatternAlpha} disabled={patternIdx === -1} />
            </label>
          </section>
          <section class="theme-section wide">
            <h3>Borders</h3>
            <div class="pattern-grid">
              <button
                class="pat-card"
                class:active={border === "none"}
                onclick={() => setBorder("none")}
                title="none"
              >
                <pre class="pat-preview border-preview pat-none">NONE</pre>
              </button>
              {#each BORDER_KEYS as k}
                <button
                  class="pat-card"
                  class:active={border === k}
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
    </div>
  </div>
</div>
{/if}

<style>
  /* Fixed ASCII texture layer — behind everything */
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

  /* Main layout — above the texture */
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
    background: var(--panel);
    border: 1px solid var(--border);
    border-left: none;
    border-radius: 0 8px 8px 0;
    padding: 0.5rem 0.5rem 0.5rem 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
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

  .signout {
    margin-top: 0.4rem;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
    font-size: 0.78rem;
    padding: 0.25rem 0.8rem;
    text-align: left;
  }
  .signout:hover { color: var(--danger); border-color: transparent; }

  /* Content column centered on the viewport; symmetric padding clears the
     floating nav on the left and mirrors it on the right on wide screens. */
  .main {
    height: 100vh;
    display: flex;
    justify-content: center;
    padding: 0 clamp(100px, 7vw, 160px);
  }

  .frame {
    flex: 1;
    max-width: 1280px;
    min-width: 0;
    position: relative;
    display: flex;
  }

  main {
    flex: 1;
    min-width: 0;
    padding: clamp(1.25rem, 3vh, 2.5rem) 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    background: transparent;
  }

  /* Frame edges: overflow-clipped character repeats, no measurement needed.
     Side columns run full height; top/bottom rows fill between them.
     Padding keeps main's scrollport (and its scrollbar) INSIDE the edges, so
     scrolled content never slides under them; margin clears the window edge. */
  .frame.framed {
    margin: 0.75rem 0;
    padding: 1.4rem 1.6rem;
  }
  .frame.framed main { padding-top: 0.75rem; padding-bottom: 0.75rem; }
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

  /* Non-chat views: children just stack; keep them from stretching oddly. */
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

  /* 5 lines × 11px fit the 56px preview card exactly. */
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
