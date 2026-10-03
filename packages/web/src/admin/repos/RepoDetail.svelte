<script lang="ts">
  import { segment } from "../../shell/router.svelte";
  import RepoLink from "./RepoLink.svelte";
  import RepoPage from "./RepoPage.svelte";

  const at = $derived(segment(3) ?? "");
</script>

{#if at === "new"}
  <RepoLink />
{:else}
  {#key at}<RepoPage slug={at} />{/key}
{/if}
