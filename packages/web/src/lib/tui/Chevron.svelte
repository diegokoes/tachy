<script lang="ts">
  import Icon from "./Icon.svelte";

  /** The expand/collapse mark: points down when open, turns to point right. */
  let { open, size = "0.9em" }: { open: boolean; size?: string } = $props();
</script>

<span class="chev" class:shut={!open} aria-hidden="true">
  <Icon name="chevron" {size} weight={8} />
</span>

<style>
  .chev {
    display: inline-flex;
    transition: transform 0.16s ease;
  }
  .shut {
    transform: rotate(-90deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
</style>
