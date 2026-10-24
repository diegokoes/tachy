<script lang="ts">
  import { G } from "./glyphs";

  let { label }: { label: string } = $props();
</script>

<!--
@component
A run of related things starts here. The rule runs out to the right edge rather
than boxing the group: what follows belongs to it until the next one starts,
which a box would have to re-state.
-->
<div class="ghead">
  <span class="mark" aria-hidden="true">{G.marker}</span>
  <span class="lbl">{label}</span>
  <span class="rule" aria-hidden="true"></span>
</div>

<style>
  .ghead {
    display: flex;
    align-self: stretch;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
  }
  .mark {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  .lbl {
    flex: none;
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
  }
  .rule {
    flex: 1;
    height: 1px;
    background: var(--border);
  }
</style>
