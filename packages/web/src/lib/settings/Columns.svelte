<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    left,
    right,
    width = "26rem",
  }: { left: Snippet; right: Snippet; width?: string } = $props();
</script>

<!-- Two columns held to reading width and centred, with what you change on the
     left. Stretched to the window, a row's name and its control ended up a
     screen apart; one column left the right half of the window empty. -->
<div class="cols" style="--col: {width}">
  <div class="col">{@render left()}</div>
  <div class="col">{@render right()}</div>
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, var(--col)));
    justify-content: center;
    align-items: start;
    column-gap: calc(var(--pad-4) * 4);
    row-gap: calc(var(--pad-4) * 1.5);
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: calc(var(--pad-4) * 1.5);
    min-width: 0;
  }

  @media (max-width: 60rem) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
