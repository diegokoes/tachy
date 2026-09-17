<script lang="ts">
  import { keyLabel } from "../keys/bindings.svelte";

  const REFERENCE: { keys: string[]; what: string }[] = [
    { keys: ["ctrl+k"], what: "focus search / composer" },
    { keys: ["⏎"], what: "open the highlighted row" },
    { keys: ["esc"], what: "dismiss a dialog or menu" },
    { keys: ["backspace"], what: "back from a detail view" },
    { keys: ["↑", "↓"], what: "move the cursor in a list" },
  ];
</script>

<p class="hint">
  These are the same everywhere and cannot be rebound. A section key set above
  will shadow one of them if you assign it here.
</p>

<ul class="ref">
  {#each REFERENCE as r}
    <li>
      <kbd>{r.keys.map(keyLabel).join(" / ")}</kbd><span>{r.what}</span>
    </li>
  {/each}
</ul>

<style>
  .hint {
    margin: 0 0 var(--pad-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .ref {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .ref li {
    display: flex;
    align-items: baseline;
    gap: var(--gap);
  }
  .ref kbd {
    flex: 0 0 13rem;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  .ref span {
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  @media (max-width: 34rem) {
    .ref li {
      flex-direction: column;
      gap: 0;
    }
    .ref kbd {
      flex: none;
    }
  }
</style>
