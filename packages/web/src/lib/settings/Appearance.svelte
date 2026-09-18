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
</script>

<Rows>
  <Row label="mode">
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
  </Row>

  <!-- Three steps, not a slider. Dragging one re-laid out the whole app on
       every frame, which reads as the UI tearing rather than resizing. -->
  <Row label="text size" hint="{Math.round(th.fontScale * 100)}% of the base size.">
    <div class="pick">
      {#each TEXT_SIZES as t}
        <Button
          variant={th.fontScale === t.scale ? "primary" : "default"}
          size="sm"
          onclick={() => setFontScale(t.scale)}>{t.key}</Button
        >
      {/each}
    </div>
  </Row>

  <Row label="nav labels">
    <div class="pick">
      {#each NAV_LABELS as l}
        <Button
          variant={th.navLabels === l ? "primary" : "default"}
          size="sm"
          onclick={() => setNavLabels(l)}>{l}</Button
        >
      {/each}
    </div>
  </Row>

  <Row label="accent">
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
    {#snippet actions()}
      <span class="hex">{th.accentColor}</span>
      {#if th.accentCustomized}
        <Button variant="ghost" size="sm" onclick={resetAccent}>reset</Button>
      {/if}
    {/snippet}
  </Row>
</Rows>

<style>
  .pick {
    display: flex;
    gap: var(--pad-2);
    flex-wrap: wrap;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(1.6rem, 1fr));
    gap: var(--pad-1);
    width: 100%;
  }
  .sw {
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
</style>
