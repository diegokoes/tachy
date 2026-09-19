<script lang="ts">
  import { FAMILIES, fontState, setFont, type FontAxis } from "../fonts.svelte";
  import { Select } from "../tui";

  const AXES: { axis: FontAxis; title: string; hint: string }[] = [
    {
      axis: "ui",
      title: "interface",
      hint: "Nav, labels, buttons, titles, table cells.",
    },
    {
      axis: "prose",
      title: "reading",
      hint: "Body text: entries, docs, chat.",
    },
    {
      axis: "mono",
      title: "monospace",
      hint: "Code, ids, character-grid graphics.",
    },
  ];

  const options = (axis: FontAxis) =>
    FAMILIES[axis].map((f) => ({ value: f.key, label: f.label }));
</script>

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
        The quick brown fox jumps over the lazy dog 0123456789
      </p>
    </div>
  {/each}
</div>

<style>
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
  .hint {
    margin: var(--pad-2) 0 0;
    font-size: var(--fs-xs);
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
