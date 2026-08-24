<script lang="ts">
  import { ANSI16, PATTERNS, PATTERN_LABELS, patternPreview } from "../ascii-patterns";
  import {
    themeState as th,
    selectAccent,
    resetAccent,
    setTheme,
    setPattern,
    setPatternAlpha,
    setFontScale,
    setRadius,
    setDensity,
    setPanelBorder,
    DENSITIES,
    PANEL_BORDERS,
    PANEL_BORDER_SAMPLE,
    RADIUS_MAX,
    RADIUS_MIN,
    SCALE_MAX,
    SCALE_MIN,
    SCALE_STEP,
  } from "../theme.svelte";
  import { Button, Panel } from "../tui";

  // black/grey are invisible on dark backgrounds; white/light-grey on light ones
  const DARK_HIDDEN = new Set(["#000000", "#666666"]);
  const LIGHT_HIDDEN = new Set(["#e5e5e5", "#ffffff"]);
  const accents = $derived(
    ANSI16.filter(
      (c) => !(th.theme === "dark" ? DARK_HIDDEN : LIGHT_HIDDEN).has(c.hex),
    ),
  );
</script>

<div class="grid">
  <Panel title="mode">
    <div class="pick">
      <Button
        variant={th.theme === "dark" ? "primary" : "default"}
        size="sm"
        onclick={() => setTheme("dark")}>dark</Button
      >
      <Button
        variant={th.theme === "light" ? "primary" : "default"}
        size="sm"
        onclick={() => setTheme("light")}>light</Button
      >
    </div>
  </Panel>

  <Panel title="accent">
    <div class="swatches">
      {#each accents as c}
        <button
          class="sw"
          class:on={th.accentColor.toLowerCase() === c.hex}
          style="background: {c.hex}"
          title="{c.name} · {c.hex}"
          aria-label={c.name}
          onclick={() => selectAccent(c.hex)}
        ></button>
      {/each}
    </div>
    <div class="foot">
      <span class="hex">{th.accentColor}</span>
      {#if th.accentCustomized}
        <Button variant="ghost" size="sm" onclick={resetAccent}>reset</Button>
      {/if}
    </div>
  </Panel>

  <Panel title="text size">
    <label class="slider">
      <span class="val">{Math.round(th.fontScale * 100)}%</span>
      <input
        type="range"
        min={SCALE_MIN}
        max={SCALE_MAX}
        step={SCALE_STEP}
        value={th.fontScale}
        oninput={(e) => setFontScale(Number(e.currentTarget.value))}
      />
    </label>
  </Panel>

  <Panel title="corners">
    <label class="slider">
      <span class="val">{th.radius}px</span>
      <input
        type="range"
        min={RADIUS_MIN}
        max={RADIUS_MAX}
        step="1"
        value={th.radius}
        oninput={(e) => setRadius(Number(e.currentTarget.value))}
      />
    </label>
    <p class="hint">
      Applies to every surface — panels, inputs, buttons, chips and dialogs.
    </p>
  </Panel>

  <Panel title="density">
    <div class="pick">
      {#each DENSITIES as d}
        <Button
          variant={th.density === d ? "primary" : "default"}
          size="sm"
          onclick={() => setDensity(d)}>{d}</Button
        >
      {/each}
    </div>
  </Panel>

  <Panel title="panel border">
    <div class="borders">
      {#each PANEL_BORDERS as b}
        <button
          class="bcard"
          class:on={th.panelBorder === b}
          title={b}
          onclick={() => setPanelBorder(b)}
        >
          <span class="bsample">{PANEL_BORDER_SAMPLE[b]}</span>
          <span class="bname">{b}</span>
        </button>
      {/each}
    </div>
  </Panel>

  <div class="wide">
    <Panel title="background">
      <div class="patterns">
        <button
          class="pcard"
          class:on={th.patternIdx === -1}
          title="plain"
          onclick={() => setPattern(-1)}
        >
          <pre class="ppreview none">NONE</pre>
        </button>
        {#each PATTERNS as _, i}
          <button
            class="pcard"
            class:on={th.patternIdx === i}
            title={PATTERN_LABELS[i]}
            onclick={() => setPattern(i)}
          >
            <pre class="ppreview">{patternPreview(i)}</pre>
          </button>
        {/each}
      </div>
      <label class="slider">
        <span class="val">intensity</span>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={th.patternAlpha}
          disabled={th.patternIdx === -1}
          oninput={(e) => setPatternAlpha(Number(e.currentTarget.value))}
        />
      </label>
    </Panel>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: var(--pad-4);
    align-items: stretch;
  }
  .wide {
    grid-column: 1 / -1;
  }

  .pick {
    display: flex;
    gap: var(--pad-2);
    flex-wrap: wrap;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(1.6rem, 1fr));
    gap: var(--pad-1);
  }
  .sw {
    aspect-ratio: 1;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    padding: 0;
  }
  .sw.on {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pad-2);
    margin-top: var(--pad-2);
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .slider {
    display: flex;
    align-items: center;
    gap: var(--gap);
  }
  .slider input {
    flex: 1;
    min-width: 0;
    padding: 0;
  }
  .val {
    font-size: var(--fs-xs);
    color: var(--muted);
    min-width: 4.5rem;
  }

  .hint {
    margin: var(--pad-2) 0 0;
    font-size: var(--fs-xs);
    color: var(--muted);
    min-height: 2.3rem;
  }

  .borders {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4rem, 1fr));
    gap: var(--pad-2);
  }
  .bcard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-1);
    font: inherit;
    cursor: pointer;
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--pad-2);
  }
  .bcard.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  /* Box-drawing glyphs — the UI face has none of them, and a per-glyph
     fallback would draw ┌─┐ out of three different widths. */
  .bsample {
    font-family: var(--font-mono);
    font-size: var(--fs-lg);
    line-height: 1;
    white-space: pre;
  }
  .bname {
    font-size: var(--fs-xs);
  }

  .patterns {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: var(--pad-2);
    margin-bottom: var(--pad-3);
  }
  .pcard {
    font: inherit;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--pad-2);
    overflow: hidden;
  }
  .pcard.on {
    border-color: var(--accent);
  }
  /* A texture swatch, not text — sized off rem rather than the type scale so
     the same number of pattern rows fills the 4rem box at every font scale. */
  .ppreview {
    margin: 0;
    font: 0.55rem/1.2 var(--font-mono);
    color: var(--muted);
    white-space: pre;
    overflow: hidden;
    height: 4rem;
  }
  .ppreview.none {
    display: grid;
    place-items: center;
    font-size: var(--fs-xs);
  }
</style>
