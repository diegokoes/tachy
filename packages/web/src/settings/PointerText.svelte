<script lang="ts">
  import { navigate } from "../shell/router.svelte";
  import { settingsPointers } from "./pointers";

  let { text }: { text: string } = $props();

  const parts = $derived(settingsPointers(text));
</script>

<!--
@component
A message that names a settings tab, with the name as a link to it.
-->
{#each parts as part, i (i)}{#if part.href}<a
      href={part.href}
      onclick={(e) => {
        e.preventDefault();
        navigate(part.href!);
      }}>{part.text}</a
    >{:else}{part.text}{/if}{/each}

<style>
  a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  a:hover,
  a:focus-visible {
    color: var(--text);
  }
</style>
