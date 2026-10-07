<script lang="ts">
  import { tick } from "svelte";
  import { themeWipe } from "../motion/motion";
  import { ANSI16 } from "./accent-palette";
  import {
    themeState as th,
    type Theme,
    selectAccent,
    resetAccent,
    setTheme,
    setFontScale,
    setNavLabels,
    setNavHidden,
    NAV_LABELS,
    TEXT_SIZES,
  } from "../theme/theme.svelte";
  import { Button, Icon, tip } from "../tui";
  import AccentModal from "./AccentModal.svelte";
  import Choice from "./Choice.svelte";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  // black/grey are invisible on dark backgrounds; white/light-grey and the
  // yellows on light ones
  const DARK_HIDDEN = new Set(["#000000", "#666666"]);
  const LIGHT_HIDDEN = new Set(["#e5e5e5", "#ffffff", "#e5e510", "#f5f543"]);
  const accents = $derived(
    ANSI16.filter(
      (c) => !(th.theme === "dark" ? DARK_HIDDEN : LIGHT_HIDDEN).has(c.hex),
    ),
  );

  const current = $derived(th.accentColor.toLowerCase());
  const custom = $derived(
    th.accentCustomized &&
      (th.accentColor2 !== null || !ANSI16.some((c) => c.hex === current)),
  );
  let picking = $state(false);

  function pickTheme(t: Theme) {
    if (t === th.theme) return;
    themeWipe(
      async () => {
        setTheme(t);
        await tick();
      },
      t === "dark" ? "top" : "bottom",
    );
  }

  const MODES = [
    { value: "dark", label: "dark" },
    { value: "light", label: "light" },
  ] as const;
  const SIZES = TEXT_SIZES.map((t) => ({ value: t.scale, label: t.key }));
  const SHOWN = [
    { value: "shown", label: "shown" },
    { value: "hidden", label: "hidden" },
  ] as const;
  const LABELS = NAV_LABELS.map((l) => ({ value: l, label: l }));
</script>

<Rows>
  <Row label="mode">
    <Choice label="mode" options={MODES} value={th.theme} onpick={pickTheme} />
  </Row>

  <!-- Three steps, not a slider: dragging one re-lays out the whole app on
       every frame, which reads as the UI tearing. -->
  <Row label="text size">
    <Choice
      label="text size"
      options={SIZES}
      value={th.fontScale}
      onpick={setFontScale}
    />
  </Row>

  <Row label="nav bar">
    <Choice
      label="nav bar"
      options={SHOWN}
      value={th.navHidden ? "hidden" : "shown"}
      onpick={(v) => setNavHidden(v === "hidden")}
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
          class:on={!custom && current === c.hex}
          role="radio"
          aria-checked={!custom && current === c.hex}
          style="background: {c.hex}"
          use:tip={c.name}
          aria-label={c.name}
          onclick={() => selectAccent(c.hex)}
        ></button>
      {/each}
      <button
        class="sw custom"
        class:on={custom}
        role="radio"
        aria-checked={custom}
        style={custom ? "background: var(--accent-fill)" : undefined}
        aria-label="custom color"
        use:tip={"custom color"}
        onclick={() => (picking = true)}
      >
        {#if !custom}<Icon name="plus" size="1em" />{/if}
      </button>
    </div>
    {#snippet actions()}
      <span class="hex"
        >{th.accentColor}{#if th.accentColor2}
          → {th.accentColor2}{/if}</span
      >
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

{#if picking}
  <AccentModal onclose={() => (picking = false)} />
{/if}

<style>
  .swatches {
    display: grid;
    grid-template-columns: repeat(7, 1.4rem);
    gap: var(--pad-1);
  }
  .sw {
    width: 1.4rem;
    aspect-ratio: 1;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    cursor: pointer;
    padding: 0;
  }
  .sw.custom {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    color: var(--muted);
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
