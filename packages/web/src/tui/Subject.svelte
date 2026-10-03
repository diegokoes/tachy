<script lang="ts">
  let { verb, name }: { verb: string; name: string } = $props();
</script>

<!-- The chrome draws no heading, so a dialog acting on one named thing says
     which one here, where it reads as part of the work rather than as a label
     on the box. -->
<p class="subject">
  <span class="k">{verb}</span><code>{name}</code>
</p>

<style>
  .subject {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    margin: 0 0 var(--pad-3);
    min-width: 0;
  }
  .k {
    flex: none;
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  code {
    font-family: var(--font-mono);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
