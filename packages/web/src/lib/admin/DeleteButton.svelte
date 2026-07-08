<script lang="ts">
  // The shared two-click delete affordance: first click arms (the square fills
  // red), second click confirms and calls onConfirm. Arming is owned here, so
  // panels only supply the actual delete action. Disarms on mouse-leave/blur so
  // a half-armed button never stays hot, and only one is ever armed at a time.
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

  let armed = $state(false);

  function click() {
    if (!armed) { armed = true; return; }
    armed = false;
    onConfirm();
  }
</script>

<button class="icon-btn danger" class:armed {disabled}
  title={armed ? "click again to delete" : title} aria-label={label}
  onclick={click} onmouseleave={() => (armed = false)} onblur={() => (armed = false)}>✕</button>
