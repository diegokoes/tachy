<script lang="ts">
  import TypeLine from "../motion/TypeLine.svelte";
  import { Chip } from "../tui";
  import { startersFor } from "./starters";

  let {
    input,
    onstart,
  }: {
    /** The composer's text: the starters step aside once there is any. */
    input: string;
    onstart: (line: string) => void;
  } = $props();

  let typed = $state(false);
</script>

<div class="launcher">
  <p class="lede">
    <TypeLine
      text="ask anything · / for commands · @ for sources"
      caret={false}
      ondone={() => (typed = true)}
    />
  </p>
  {#if typed}
    <div class="starters">
      {#each startersFor(input) as starter (starter.key)}
        <Chip onclick={() => onstart(starter.line)}>{starter.label}</Chip>
      {/each}
    </div>
  {/if}
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
  .starters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-2);
    margin-top: var(--pad-3);
  }
</style>
