<script lang="ts">
  import {
    ANSI16,
    BORDER_KEYS,
    PATTERNS,
    PATTERN_LABELS,
    borderPreview,
    patternPreview,
  } from "./ascii-patterns";
  import {
    themeState as th,
    selectAccent,
    resetAccent,
    setTheme,
    setPattern,
    setPatternAlpha,
    setFontScale,
    setBorder,
  } from "./theme.svelte";

  // black/grey are invisible on dark backgrounds; white/light-grey on light ones
  const DARK_HIDDEN = new Set(["#000000", "#666666"]);
  const LIGHT_HIDDEN = new Set(["#e5e5e5", "#ffffff"]);
  const visibleAccents = $derived(
    ANSI16.filter((c) => !(th.theme === "dark" ? DARK_HIDDEN : LIGHT_HIDDEN).has(c.hex)),
  );
</script>

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
      {#each visibleAccents as c}
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

<style>
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

  /* Reset default appearance so the thumb reaches true min/max positions */
  .slider-row input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 200px;
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    accent-color: var(--accent);
    cursor: pointer;
    outline-offset: 4px;
  }
  .slider-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--accent);
  }
  .slider-row input[type="range"]::-moz-range-track {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
  }
  .slider-row input[type="range"]::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--accent);
    border: none;
  }

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
