<script lang="ts">
  import { themeState } from "../../theme/theme.svelte";

  let { icon, light }: { icon: string; light?: string | null } = $props();

  const id = $derived(themeState.theme === "light" && light ? light : icon);
</script>

<img
  class="ficon"
  src="/api/repos/file-icons/{id}.svg"
  alt=""
  width="16"
  height="16"
  loading="lazy"
/>

<style>
  .ficon {
    flex: none;
    width: 1.1em;
    height: 1.1em;
  }
</style>
