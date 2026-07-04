<script lang="ts">
  import { onMount } from "svelte";
  import ChatView from "./lib/ChatView.svelte";
  import KnowledgeView from "./lib/KnowledgeView.svelte";
  import ReferenceView from "./lib/ReferenceView.svelte";
  import AdminView from "./lib/AdminView.svelte";
  import IntroSplash from "./lib/IntroSplash.svelte";
  import { gsap, reducedMotion } from "./lib/gsap";

  type View = "chat" | "knowledge" | "reference" | "admin" | "theme";
  const nav: { key: View; label: string }[] = [
    { key: "chat", label: "Tachy" },
    { key: "knowledge", label: "Knowledge" },
    { key: "reference", label: "Reference" },
    { key: "admin", label: "Admin" },
    { key: "theme", label: "Theme" },
  ];

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
  let theme = $state<Theme>("dark");
  let patternIdx = $state(0); // -1 = plain background
  let patternAlpha = $state(0.35);
  let accentColor = $state(ACCENT_DEFAULTS.dark);
  let accentCustomized = $state(false);
  let fontScale = $state(1);

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

  function onAccentInput(e: Event) {
    accentCustomized = true;
    applyAccent((e.target as HTMLInputElement).value);
    localStorage.setItem("tachy-accent", accentColor);
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
    // No splash (reduced motion) → the menu must still reveal itself.
    if (!splash) revealNav();
  });
</script>

{#if splash}
  <IntroSplash onDone={() => { splash = false; revealNav(); }} />
{/if}

{#if patternIdx >= 0}
  <pre class="ascii-bg" style="opacity: {patternAlpha}">{PATTERNS[patternIdx]}</pre>
{/if}

<div class="app">
  <aside>
    <nav bind:this={navEl} class:unrevealed={!navRevealed}>
      {#each nav as n}
        <button class:active={view === n.key} onclick={() => (view = n.key)}>{n.label}</button>
      {/each}
    </nav>
  </aside>

  <div class="main">
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
          <section class="theme-section">
            <h3>Accent color</h3>
            <div class="accent-row">
              <input
                type="color"
                value={accentColor}
                oninput={onAccentInput}
                class="accent-swatch"
              />
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
        </div>
      {:else}
        <ChatView />
      {/if}
    </main>
  </div>
</div>

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

  /* Content column centered on the viewport; symmetric padding clears the
     floating nav on the left and mirrors it on the right on wide screens. */
  .main {
    height: 100vh;
    display: flex;
    justify-content: center;
    padding: 0 clamp(120px, 10vw, 200px);
  }

  main {
    flex: 1;
    max-width: 1080px;
    min-width: 0;
    padding: clamp(1.25rem, 3vh, 2.5rem) 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    background: transparent;
  }

  /* Non-chat views: children just stack; keep them from stretching oddly. */
  main > :global(*) { flex-shrink: 0; }
  main > :global(.chat) { flex: 1 1 auto; min-height: 0; }

  @media (max-width: 900px) {
    .main { padding: 0 0.9rem 0 118px; }
  }

  /* Theme panel */
  .theme-panel {
    display: flex;
    flex-direction: column;
    gap: 2.25rem;
    max-width: 680px;
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

  .accent-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .accent-swatch {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--border);
    padding: 2px;
    background: none;
    cursor: pointer;
  }

  .accent-hex {
    font-size: 0.85rem;
    color: var(--muted);
  }

  .reset { font-size: 0.8rem; padding: 0.2rem 0.6rem; color: var(--muted); }
</style>
