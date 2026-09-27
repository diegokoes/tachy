<script lang="ts">
  import { FAMILIES, fontState, setFont, type FontAxis } from "../fonts.svelte";
  import { Select } from "../tui";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

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

<Rows>
  {#each AXES as a}
    <Row label={a.title} hint={a.hint}>
      <Select
        value={fontState[a.axis]}
        options={options(a.axis)}
        onchange={(v) => setFont(a.axis, String(v))}
      />
      <p class="sample" style="font-family: var(--font-{a.axis})">
        The quick brown fox jumps over the lazy dog 0123456789
      </p>
    </Row>
  {/each}
</Rows>

<style>
  /* The specimen is the control: a name in a dropdown says nothing about how a
     face reads at the size this app actually sets it. */
  .sample {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.5;
    color: var(--text);
  }
</style>
