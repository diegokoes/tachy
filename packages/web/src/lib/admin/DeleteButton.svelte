<script lang="ts">
  import { Button } from "../tui";

  let {
    onConfirm,
    title = "delete",
    label = "delete",
    disabled = false,
  }: {
    onConfirm: () => void | Promise<void>;
    title?: string;
    label?: string;
    disabled?: boolean;
  } = $props();

  /** Two-click arm: the mark swaps ✕ → ✓ rather than swapping in longer text,
      so the row never reflows. */
  let armed = $state(false);

  function click() {
    if (!armed) {
      armed = true;
      return;
    }
    armed = false;
    onConfirm();
  }
</script>

<span class="wrap">
  <Button
    variant="ghost"
    tone="danger"
    square
    icon={armed ? "check" : "cancel"}
    {disabled}
    title={armed ? "click again to delete" : title}
    aria-label={label}
    onclick={click}
  />
</span>

<svelte:window
  onblur={() => (armed = false)}
/>

<style>
  .wrap {
    display: inline-flex;
  }
</style>
