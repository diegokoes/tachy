<script lang="ts">
  import Icon from "./Icon.svelte";

  let { message, label = "error" }: { message: string; label?: string } =
    $props();

  let copied = $state(false);

  /** Clone/auth failures run to paragraphs — keep them out of the layout
      entirely: the icon is fixed size, the text lives in the tooltip, and a
      click puts the whole thing on the clipboard. */
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      copied = false;
    }
  }
</script>

<button
  class="errmark"
  class:copied
  type="button"
  title={copied ? "copied" : `${message}\n\n(click to copy)`}
  aria-label={`${label}: ${message}`}
  onclick={copy}
>
  <Icon name="alert" size="1em" weight={7} />
</button>

<style>
  .errmark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 1.5em;
    height: 1.5em;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--danger);
    cursor: pointer;
  }
  .errmark:hover,
  .errmark:focus-visible {
    outline: none;
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }
  .errmark.copied {
    color: var(--ok);
    border-color: var(--ok);
  }
</style>
