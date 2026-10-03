<script lang="ts">
  import {
    FAMILIES,
    fontState,
    setFont,
    type FontAxis,
  } from "../theme/fonts.svelte";
  import { Select } from "../tui";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  const AXES: { axis: FontAxis; title: string }[] = [
    { axis: "ui", title: "interface" },
    { axis: "prose", title: "reading" },
    { axis: "mono", title: "monospace" },
  ];

  const options = (axis: FontAxis) =>
    FAMILIES[axis].map((f) => ({ value: f.key, label: f.label }));
</script>

<Rows>
  {#each AXES as a}
    <Row label={a.title}>
      <Select
        aria-label="{a.title} font"
        value={fontState[a.axis]}
        options={options(a.axis)}
        onchange={(v) => setFont(a.axis, String(v))}
      />
    </Row>
  {/each}
</Rows>
