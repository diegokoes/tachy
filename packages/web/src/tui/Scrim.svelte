<script lang="ts">
  let {
    onclick,
    element = $bindable(),
  }: {
    onclick?: () => void;
    /** The scrim itself, for the dialog that fades it in and out. */
    element?: HTMLElement;
  } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" role="presentation" bind:this={element} {onclick}></div>

<style>
  /* Ink only. The blur that puts the app on a plane behind the dialog is a
     filter on the app itself, [data-scene] in App.svelte. */
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim-ink);
  }
</style>
