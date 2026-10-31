<script lang="ts">
  import type { Snippet } from "svelte";

  let { label, children }: { label: string; children: Snippet } = $props();

  /** How much wider than its cap a control is at least. */
  const CAP_ROOM = 1.25;

  /**
   * A control never reads narrower than the cap naming it - the caps are what
   * the row is scanned by. Measured rather than guessed at in `ch`: the cap is
   * a different size and tracking from the control under it.
   */
  function capFloor(node: HTMLElement) {
    const cap = node.querySelector<HTMLElement>(".cap");
    if (!cap) return;
    const apply = () => {
      node.style.minWidth = `${Math.ceil(cap.offsetWidth * CAP_ROOM)}px`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(cap);
    return { destroy: () => observer.disconnect() };
  }
</script>

<!--
@component
A control in a bar of controls, named by a small cap above it: the name stays
in sight once a value is picked, where a word inside the control would not.
-->
<span class="field" use:capFloor>
  <span class="cap">{label}</span>
  {@render children()}
</span>

<style>
  .field {
    display: inline-flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  /* Its own width, not the column's, so `capFloor` can measure the text and
     the auto margins can centre it over the control. */
  .cap {
    width: max-content;
    max-width: 100%;
    margin-inline: auto;
    font-size: var(--fs-xs);
    line-height: 1;
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    text-align: center;
    color: var(--muted);
  }
</style>
