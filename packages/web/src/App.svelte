<script lang="ts">
  import { onMount } from "svelte";
  import ChatView from "./lib/ChatView.svelte";
  import KnowledgeView from "./lib/KnowledgeView.svelte";
  import ReferenceView from "./lib/ReferenceView.svelte";
  import AdminView from "./lib/AdminView.svelte";

  type View = "chat" | "knowledge" | "reference" | "admin" | "theme";
  const nav: { key: View; label: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "knowledge", label: "Knowledge" },
    { key: "reference", label: "Reference" },
    { key: "admin", label: "Admin" },
    { key: "theme", label: "Theme" },
  ];

  let view = $state<View>("knowledge");
  let patternIdx = $state(0);
  let accentColor = $state("#6ea8fe");

  const PATTERN_LABELS = ["brackets", "rope", "slashes", "bricks"];

  function patternPreview(idx: number): string {
    return PATTERNS[idx].split("\n").slice(0, 5).map(l => l.slice(0, 26)).join("\n");
  }

  // ── ASCII background generation ─────────────────────────────────────────
  // Each row is a single repeating unit. makeBg tiles it to fill large screens.
  function makeBg(rows: string[], vRep = 60): string {
    const wide = rows.map(u => u.repeat(Math.ceil(650 / u.length) + 2));
    return (wide.join("\n") + "\n").repeat(vRep);
  }

  // Period-8 stacked brackets
  // Row units verified: ' |___  |', '    _|_|', '_  | |__', '_|_|    '
  // Row 2 junction: '__' + '_  |' → '___  |' ✓
  const P0 = makeBg([" |___  |", "    _|_|", "_  | |__", "_|_|    "]);

  // Curved rope — straight rows period-5, curve rows period-11/10
  const P1 = makeBg(["  |  ", "`.__.' _.'", ',-"  ,-""-', "  |  "]);

  // Diagonal slashes — period-12 all rows
  // Row units: '   /   __/  ', '__   \__/  \', '  \__/  \   ', '__/     /   '
  const P2 = makeBg(["   /   __/  ", "__   \\__/  \\", "  \\__/  \\   ", "__/     /   "]);

  // H-bricks — period-9 all rows
  const P3 = makeBg(["__|__|   ", " __|__|  ", "|   __|__", "|__|   __"]);

  const PATTERNS: string[] = [P0, P1, P2, P3];

  function setPattern(idx: number) {
    patternIdx = idx;
    localStorage.setItem("tachy-pattern", String(idx));
  }

  function onAccentInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    accentColor = v;
    document.documentElement.style.setProperty("--accent", v);
    localStorage.setItem("tachy-accent", v);
  }

  onMount(() => {
    const savedPattern = localStorage.getItem("tachy-pattern");
    if (savedPattern !== null) patternIdx = Number(savedPattern);
    const savedAccent = localStorage.getItem("tachy-accent");
    if (savedAccent) {
      accentColor = savedAccent;
      document.documentElement.style.setProperty("--accent", savedAccent);
    }
  });
</script>

<pre class="ascii-bg">{PATTERNS[patternIdx]}</pre>

<div class="app">
  <aside>
    <nav>
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
            <h3>Background</h3>
            <div class="pattern-grid">
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
            </div>
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
    color: rgba(255, 255, 255, 0.055);
    pointer-events: none;
    user-select: none;
    background: var(--bg);
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
    padding: 0.4rem 0.4rem 0.4rem 0.3rem;
    display: flex;
    flex-direction: column;
  }

  nav { display: flex; flex-direction: column; gap: 0.15rem; }

  nav button {
    text-align: left;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
    padding: 0.35rem 0.8rem;
    white-space: nowrap;
    font-size: 0.95rem;
  }

  nav button:hover { color: var(--text); border-color: transparent; }

  nav button.active {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent);
  }

  .main { display: flex; flex-direction: column; height: 100vh; min-width: 0; padding-left: 110px; }

  main {
    flex: 1;
    padding: 1.5rem 2rem;
    overflow: auto;
    background: transparent;
  }

  /* Theme panel */
  .theme-panel {
    display: flex;
    flex-direction: column;
    gap: 2.5rem;
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

  .pattern-grid {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
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
    color: rgba(255, 255, 255, 0.4);
    pointer-events: none;
    user-select: none;
    white-space: pre;
    overflow: hidden;
    width: 156px;
    height: 56px;
  }

  .pat-card.active .pat-preview { color: rgba(255, 255, 255, 0.65); }

  .pat-label { display: none; }

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
    font-family: monospace;
  }
</style>
