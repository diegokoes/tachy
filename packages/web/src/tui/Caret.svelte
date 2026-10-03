<script lang="ts">
  import { shapes } from "./icons";

  let {
    beat,
  }: {
    /**
     * Anything that changes on activity. The flash starts over when it does,
     * so the caret stays lit while someone is typing.
     */
    beat?: unknown;
  } = $props();
</script>

{#key beat}
  <svg
    class="caret"
    viewBox="2 2 4 20"
    fill="none"
    stroke="currentColor"
    stroke-width="2.9"
    stroke-linecap="round"
    aria-hidden="true"
  >
    {#each shapes("caret") as [tag, attrs]}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
{/key}

<style>
  .caret {
    flex: none;
    display: inline-block;
    width: 0.23em;
    height: 1.15em;
    vertical-align: text-bottom;
    animation: caret-beat 1.2s infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
  }
</style>
