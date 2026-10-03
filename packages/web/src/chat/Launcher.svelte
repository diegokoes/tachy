<script lang="ts">
  import TypeLine from "../TypeLine.svelte";
</script>

<div class="launcher">
  <p class="lede">
    <TypeLine text="Ask anything, or type / for commands." />
  </p>
</div>

<style>
  .launcher {
    padding: var(--pad-3) 0;
    max-width: 46rem;
  }
  .lede {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-md);
  }
</style>
