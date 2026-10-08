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
  {#each AXES as axis}
    <Row label={axis.title}>
      <Select
        aria-label="{axis.title} font"
        value={fontState[axis.axis]}
        options={options(axis.axis)}
        onchange={(v) => setFont(axis.axis, String(v))}
      />
    </Row>
  {/each}
</Rows>
