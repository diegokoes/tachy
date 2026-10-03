<script lang="ts">
  import Columns from "./Columns.svelte";
  import FixedKeys from "./FixedKeys.svelte";
  import Group from "./Group.svelte";
  import NavKeys from "./NavKeys.svelte";
  import VimKeys from "./VimKeys.svelte";
</script>

<Columns>
  {#snippet left()}
    <Group label="sections"><NavKeys /></Group>
  {/snippet}
  {#snippet right()}
    <Group label="fixed"><FixedKeys /></Group>
    <Group label="vim"><VimKeys /></Group>
  {/snippet}
</Columns>
