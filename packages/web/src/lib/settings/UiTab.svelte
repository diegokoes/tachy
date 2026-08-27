<script lang="ts">
  import { ANSI16 } from "../accent-palette";
  import {
    themeState as th,
    selectAccent,
    resetAccent,
    setTheme,
    setFontScale,
    TEXT_SIZES,
  } from "../theme.svelte";
  import { FAMILIES, fontState, setFont, type FontAxis } from "../fonts.svelte";
  import { Button, Panel, Select } from "../tui";

  // black/grey are invisible on dark backgrounds; white/light-grey on light ones
  const DARK_HIDDEN = new Set(["#000000", "#666666"]);
  const LIGHT_HIDDEN = new Set(["#e5e5e5", "#ffffff"]);
  const accents = $derived(
    ANSI16.filter(
      (c) => !(th.theme === "dark" ? DARK_HIDDEN : LIGHT_HIDDEN).has(c.hex),
    ),
  );

  const AXES: { axis: FontAxis; title: string; hint: string }[] = [
    {
      axis: "ui",
      title: "interface",
      hint: "Nav, labels, buttons, panel titles and table cells.",
    },
    {
      axis: "prose",
      title: "reading",
      hint: "Running text: entry bodies, docs and the chat transcript.",
    },
    {
      axis: "mono",
      title: "monospace",
      hint: "Code, ids, and anything drawn on a character grid.",
    },
  ];

  const options = (axis: FontAxis) =>
    FAMILIES[axis].map((f) => ({ value: f.key, label: f.label }));
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

  <Panel title="text size">
    <!-- Three steps, not a slider. Dragging one re-laid out the whole app on
         every frame, which reads as the UI tearing rather than resizing. -->
    <div class="pick">
      {#each TEXT_SIZES as t}
        <Button
          variant={th.fontScale === t.scale ? "primary" : "default"}
          size="sm"
          onclick={() => setFontScale(t.scale)}>{t.key}</Button
        >
      {/each}
    </div>
    <p class="hint">{Math.round(th.fontScale * 100)}% of the base size.</p>
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

  <div class="wide">
    <Panel title="fonts">
      <div class="fonts">
        {#each AXES as a}
          <div class="axis">
            <span class="axis-name">{a.title}</span>
            <Select
              value={fontState[a.axis]}
              options={options(a.axis)}
              onchange={(v) => setFont(a.axis, String(v))}
            />
            <p class="hint">{a.hint}</p>
            <p class="sample" style="font-family: var(--font-{a.axis})">
              The quick brown fox jumps over the lazy dog — 0123456789
            </p>
          </div>
        {/each}
      </div>
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
    border-radius: var(--radius-control);
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

  .hint {
    margin: var(--pad-2) 0 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .fonts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--pad-4);
  }
  .axis-name {
    display: block;
    margin-bottom: var(--pad-2);
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
  }
  /* The specimen is the control: a name in a dropdown says nothing about how a
     face reads at the size this app actually sets it. */
  .sample {
    margin: var(--pad-2) 0 0;
    padding-top: var(--pad-2);
    border-top: 1px solid var(--border);
    font-size: var(--fs-sm);
    line-height: 1.5;
    color: var(--text);
  }
</style>
