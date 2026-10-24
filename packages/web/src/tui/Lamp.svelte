<script lang="ts">
  import { LAMP_GLYPHS, type Lamp } from "./lamp";

  let {
    lamp,
    word,
    quiet = false,
  }: {
    lamp: Lamp;
    word: string;
    /** Mixed halfway into muted, for a status beside a title it must not outshout. */
    quiet?: boolean;
  } = $props();
</script>

<!--
@component
A status as a lamp and its word: ● settled, ◐ under way, ○ not started or off,
in the status's tone.
-->
<span class="lamp {lamp.tone}" class:quiet
  ><span class="glyph" aria-hidden="true">{LAMP_GLYPHS[lamp.level]}</span
  >{word}</span
>

<style>
  .lamp {
    --tone: var(--muted);
    display: inline-flex;
    align-items: baseline;
    gap: 0.4em;
    white-space: nowrap;
    color: var(--tone);
  }
  .accent {
    --tone: var(--accent);
  }
  .ok {
    --tone: var(--ok);
  }
  .warn {
    --tone: var(--warn);
  }
  .danger {
    --tone: var(--danger);
  }
  .info {
    --tone: var(--info);
  }
  /* A size up, so the half lamp reads as half at a label's size. */
  .glyph {
    font-family: var(--font-mono);
    font-size: 1.2em;
    line-height: 1;
  }
  .quiet {
    color: color-mix(in srgb, var(--tone) 55%, var(--muted));
  }
</style>
