<script lang="ts">
  import { ANSI16 } from "../accent-palette";
  import {
    themeState as th,
    selectAccent,
    resetAccent,
    setTheme,
    setFontScale,
    setNavLabels,
    NAV_LABELS,
    TEXT_SIZES,
  } from "../theme.svelte";
  import { Button } from "../tui";
  import Choice from "./Choice.svelte";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  // black/grey are invisible on dark backgrounds; white/light-grey on light ones
  const DARK_HIDDEN = new Set(["#000000", "#666666"]);
  const LIGHT_HIDDEN = new Set(["#e5e5e5", "#ffffff"]);
  const accents = $derived(
    ANSI16.filter(
      (c) => !(th.theme === "dark" ? DARK_HIDDEN : LIGHT_HIDDEN).has(c.hex),
    ),
  );

  const MODES = [
    { value: "dark", label: "dark" },
    { value: "light", label: "light" },
  ] as const;
  const SIZES = TEXT_SIZES.map((t) => ({ value: t.scale, label: t.key }));
  const LABELS = NAV_LABELS.map((l) => ({ value: l, label: l }));
</script>

<Rows>
  <Row label="mode">
    <Choice label="mode" options={MODES} value={th.theme} onpick={setTheme} />
  </Row>

  <!-- Three steps, not a slider. Dragging one re-laid out the whole app on
       every frame, which reads as the UI tearing rather than resizing. -->
  <Row label="text size">
    <Choice
      label="text size"
      options={SIZES}
      value={th.fontScale}
      onpick={setFontScale}
    />
  </Row>

  <Row label="nav labels">
    <Choice
      label="nav labels"
      options={LABELS}
      value={th.navLabels}
      onpick={setNavLabels}
    />
  </Row>

  <Row label="accent">
    <div class="swatches" role="radiogroup" aria-label="accent">
      {#each accents as c}
        <button
          class="sw"
          class:on={th.accentColor.toLowerCase() === c.hex}
          role="radio"
          aria-checked={th.accentColor.toLowerCase() === c.hex}
          style="background: {c.hex}"
          title="{c.name} · {c.hex}"
          aria-label={c.name}
          onclick={() => selectAccent(c.hex)}
        ></button>
      {/each}
    </div>
    {#snippet actions()}
      <span class="hex">{th.accentColor}</span>
      <span class="slot">
        {#if th.accentCustomized}
          <Button
            variant="ghost"
            square
            icon="reset"
            title="reset"
            aria-label="reset accent"
            onclick={resetAccent}
          />
        {/if}
      </span>
    {/snippet}
  </Row>
</Rows>

<style>
  .swatches {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--pad-1);
  }
  .sw {
    width: 1.6rem;
    aspect-ratio: 1;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    cursor: pointer;
    padding: 0;
  }
  .sw.on {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }

  .hex {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
    white-space: nowrap;
  }
  .slot {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--row-h);
  }
</style>
