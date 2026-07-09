<script lang="ts">
  
  
  
  
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
